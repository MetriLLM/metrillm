import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import type { OllamaModel, OllamaRunningModel } from "../types.js";
import type { GenerateResult, KeepAliveValue, StreamCallbacks } from "./ollama-client.js";
import { estimateTokenCount } from "../utils.js";

const DEFAULT_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234";
const LM_STUDIO_INIT_TIMEOUT_MS = 15_000;
const LM_STUDIO_METADATA_TIMEOUT_MS = 2_000;
const DEFAULT_STREAM_STALL_TIMEOUT_MS = 180_000;
const DEFAULT_LM_STUDIO_HOME_DIR = path.join(os.homedir(), ".lmstudio");
const DEFAULT_LM_STUDIO_MODELS_DIR = path.join(DEFAULT_LM_STUDIO_HOME_DIR, "models");
const LM_STUDIO_HOME_DIR_ENV = "LM_STUDIO_HOME_DIR";
const LM_STUDIO_MODELS_DIR_ENV = "LM_STUDIO_MODELS_DIR";

let defaultKeepAlive: KeepAliveValue | undefined;
const activeAbortControllers = new Set<AbortController>();
const directorySizeCache = new Map<string, number>();
const modelDefinitionCache = new Map<string, LMStudioModelDefinition | null>();

interface LMStudioModelListResponse {
  data?: Array<{ id?: string }>;
}

interface LMStudioApiModel {
  id?: string;
  arch?: string;
  type?: string;
  publisher?: string;
  compatibility_type?: string;
  quantization?: string;
  state?: string;
  size?: number;
  size_bytes?: number;
  model_size_bytes?: number;
  file_size_bytes?: number;
  bytes?: number;
}

interface LMStudioApiModelListResponse {
  data?: LMStudioApiModel[];
}

interface LMStudioHistoricalVersionInfo {
  lastRecorderdAppVersion?: unknown;
  lastRecordedAppVersion?: unknown;
  lastRecordedAppBuildVersion?: unknown;
}

interface LMStudioModelSource {
  user: string;
  repo: string;
}

interface LMStudioModelDefinition {
  parameterSize?: string;
  sources: LMStudioModelSource[];
}

interface LMStudioUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface LMStudioChoice {
  delta?: {
    content?: string;
    reasoning_content?: string;
    reasoning?: string;
  };
  message?: {
    content?: string;
    reasoning_content?: string;
    reasoning?: string;
  };
}

interface LMStudioChatCompletionChunk {
  usage?: LMStudioUsage;
  choices?: LMStudioChoice[];
}

interface LMStudioChatMessage {
  role: "system" | "user";
  content: string;
}

interface LMStudioThinkingConfig {
  include_reasoning: boolean;
  reasoning_effort: "low" | "high";
  reasoning: {
    effort: "low" | "high";
  };
}

interface LMStudioRequestOptions {
  temperature?: number;
  top_p?: number;
  seed?: number;
  num_predict?: number;
  keep_alive?: KeepAliveValue;
  think?: boolean;
  stall_timeout_ms?: number;
}

const NON_THINKING_SYSTEM_PROMPT = [
  "You are in non-thinking mode for benchmark reproducibility.",
  "Return only the final answer.",
  "Do not output internal reasoning, chain-of-thought, or scratchpad.",
  "Never output tags or sections like <think>, </think>, [THINK], [/THINK], or Thinking Process.",
].join(" ");

function hasThinkingLeakText(response: string): boolean {
  return (
    /^\s*(?:thinking|thought)\s+process\s*:/i.test(response)
    || /\[(?:\/)?THINK(?:ING)?\]/i.test(response)
  );
}

function assertThinkingModeRespected(
  model: string,
  think: boolean | undefined,
  response: string,
  reasoning: string
): void {
  if (think !== false) return;
  if (reasoning.trim().length > 0 || /<think(?:ing)?[\s>]/i.test(response) || hasThinkingLeakText(response)) {
    throw new Error(
      [
        `LM Studio model "${model}" still emitted thinking content while non-thinking mode is requested.`,
        "In LM Studio, add this at the top of the model chat template: {%- set enable_thinking = false %}.",
        "If this model does not expose a Prompt/Chat Template editor in LM Studio (e.g. some GPT-OSS builds), non-thinking mode cannot be enforced from the API.",
        "Use --thinking for this model, or benchmark a model/runtime that supports explicit non-thinking control.",
        "Then eject/reload the model and run the benchmark again.",
      ].join(" ")
    );
  }
}

function buildThinkingConfig(think?: boolean): Partial<LMStudioThinkingConfig> {
  if (think === undefined) return {};
  const effort = think ? "high" : "low";
  return {
    include_reasoning: think,
    reasoning_effort: effort,
    reasoning: { effort },
  };
}

function hasSamplingOverrides(options?: LMStudioRequestOptions): boolean {
  return options?.top_p !== undefined || options?.seed !== undefined;
}

function isUnsupportedSamplingMessage(status: number, text: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const lower = text.toLowerCase();
  const mentionsSampling = /\b(seed|top_p|topp)\b/.test(lower);
  if (!mentionsSampling) return false;
  return /unrecognized|unknown|not support|unsupported|invalid|unexpected|additional|extra/.test(lower);
}

function extractLMStudioErrorMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: {
        message?: unknown;
      };
    };
    const message = parsed.error?.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  } catch {
    // Fall back to raw response body text when payload is not JSON.
  }
  return trimmed;
}

function isModelLoadGuardrailError(message: string): boolean {
  const lower = message.toLowerCase();
  if (!lower.includes("failed to load model")) return false;
  return (
    lower.includes("insufficient system resources")
    || lower.includes("overload your system")
    || lower.includes("loading guardrails")
  );
}

function buildLMStudioRequestError(
  kind: "generate" | "stream",
  model: string,
  status: number,
  statusText: string,
  body: string
): Error {
  const backendMessage = extractLMStudioErrorMessage(body);
  if (isModelLoadGuardrailError(backendMessage)) {
    return new Error(
      [
        `LM Studio could not load model "${model}" due to insufficient system resources (model loading guardrails).`,
        "In LM Studio: unload other models, reduce loaded context length, or relax model loading guardrails in Settings.",
        `Backend error: ${backendMessage}`,
      ].join(" ")
    );
  }
  const suffix = backendMessage ? ` ${backendMessage}` : "";
  return new Error(`LM Studio ${kind} failed (${status} ${statusText})${suffix}`.trim());
}

function buildChatCompletionBody(
  model: string,
  prompt: string,
  options: LMStudioRequestOptions | undefined,
  stream: boolean,
  includeSampling: boolean
): Record<string, unknown> {
  const messages: LMStudioChatMessage[] =
    options?.think === false
      ? [
        { role: "system", content: NON_THINKING_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]
      : [{ role: "user", content: prompt }];

  return {
    model,
    messages,
    temperature: options?.temperature ?? 0,
    ...(includeSampling && options?.top_p !== undefined ? { top_p: options.top_p } : {}),
    ...(includeSampling && options?.seed !== undefined ? { seed: options.seed } : {}),
    max_tokens: options?.num_predict ?? 512,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...buildThinkingConfig(options?.think),
  };
}

function parseNonNegativeInt(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function resolveStreamStallTimeoutMs(override?: number): number | undefined {
  if (override !== undefined) {
    if (!Number.isFinite(override) || override < 0) return DEFAULT_STREAM_STALL_TIMEOUT_MS;
    return override === 0 ? undefined : Math.trunc(override);
  }

  const configured = process.env.LM_STUDIO_STREAM_STALL_TIMEOUT_MS?.trim();
  if (!configured) return DEFAULT_STREAM_STALL_TIMEOUT_MS;
  const parsed = parseNonNegativeInt(configured);
  if (parsed === null) return DEFAULT_STREAM_STALL_TIMEOUT_MS;
  return parsed === 0 ? undefined : parsed;
}

function getLMStudioBaseUrl(): string {
  const configured = process.env.LM_STUDIO_BASE_URL?.trim();
  if (!configured) return DEFAULT_LM_STUDIO_BASE_URL;
  const candidate = /^https?:\/\//i.test(configured) ? configured : `http://${configured}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return DEFAULT_LM_STUDIO_BASE_URL;
  }
}

function getLMStudioHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.LM_STUDIO_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function extractUsage(payload: unknown): LMStudioUsage | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const usage = (payload as { usage?: LMStudioUsage }).usage;
  if (!usage) return undefined;
  return usage;
}

function extractChoice(payload: unknown): LMStudioChoice | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const choices = (payload as LMStudioChatCompletionChunk).choices;
  if (!choices || choices.length === 0) return undefined;
  return choices[0];
}

function extractContent(choice: LMStudioChoice | undefined): string {
  const content = choice?.delta?.content ?? choice?.message?.content;
  return typeof content === "string" ? content : "";
}

function extractReasoning(choice: LMStudioChoice | undefined): string {
  const reasoning =
    choice?.delta?.reasoning_content ??
    choice?.delta?.reasoning ??
    choice?.message?.reasoning_content ??
    choice?.message?.reasoning;
  return typeof reasoning === "string" ? reasoning : "";
}

function getUsageTokenCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.trunc(value);
}

function estimateCompletionTokensFallback(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;

  // CJK-like scripts often have sparse/no whitespace, so whitespace tokenization
  // underestimates badly. Count those codepoints directly and estimate the rest.
  const cjkMatches = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu);
  const cjkCount = cjkMatches?.length ?? 0;
  const withoutCjk = normalized.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
    ""
  );
  const nonCjkChars = withoutCjk.replace(/\s+/g, "").length;
  const nonCjkHeuristic = Math.ceil(nonCjkChars / 4);
  const whitespaceEstimate = estimateTokenCount(normalized);

  return Math.max(1, Math.max(whitespaceEstimate, cjkCount + nonCjkHeuristic));
}

function resolveCompletionTokenCount(
  usage: LMStudioUsage | undefined,
  response: string,
  reasoning: string
): number {
  const reported = getUsageTokenCount(usage?.completion_tokens);
  if (reported > 0) return reported;
  return estimateCompletionTokensFallback(`${reasoning} ${response}`);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/^["']|["']$/g, "").trim();
}

function normalizeToken(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tokenizeModelName(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && /[a-z]/.test(token));
}

function getLMStudioHomeDir(): string {
  const fromEnv = process.env[LM_STUDIO_HOME_DIR_ENV]?.trim();
  if (!fromEnv) return DEFAULT_LM_STUDIO_HOME_DIR;
  if (fromEnv.startsWith("~")) {
    return path.join(os.homedir(), fromEnv.slice(1));
  }
  return fromEnv;
}

async function pathIsDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch (_err: unknown) {
    return false;
  }
}

async function loadHubModelDefinition(modelId: string): Promise<LMStudioModelDefinition | null> {
  if (modelDefinitionCache.has(modelId)) {
    return modelDefinitionCache.get(modelId) ?? null;
  }

  const [publisher, modelName] = modelId.split("/", 2);
  if (!publisher || !modelName) {
    modelDefinitionCache.set(modelId, null);
    return null;
  }

  const yamlPath = path.join(getLMStudioHomeDir(), "hub", "models", publisher, modelName, "model.yaml");
  let content = "";
  try {
    content = await fs.readFile(yamlPath, "utf8");
  } catch {
    modelDefinitionCache.set(modelId, null);
    return null;
  }

  const sourcePattern = /user:\s*([^\n#]+?)\s*(?:\r?\n)\s*repo:\s*([^\n#]+?)\s*(?:\r?\n|$)/g;
  const sourceMap = new Map<string, LMStudioModelSource>();
  let sourceMatch: RegExpExecArray | null = null;
  while ((sourceMatch = sourcePattern.exec(content)) !== null) {
    const user = stripOptionalQuotes(sourceMatch[1] ?? "");
    const repo = stripOptionalQuotes(sourceMatch[2] ?? "");
    if (!user || !repo) continue;
    sourceMap.set(`${user}/${repo}`, { user, repo });
  }

  const paramsPattern = /paramsStrings:\s*(?:\r?\n)\s*-\s*([^\n#]+)/;
  const paramsMatch = paramsPattern.exec(content);
  const parameterSize = paramsMatch?.[1] ? stripOptionalQuotes(paramsMatch[1]) : undefined;

  const definition: LMStudioModelDefinition = {
    parameterSize: parameterSize || undefined,
    sources: Array.from(sourceMap.values()),
  };
  modelDefinitionCache.set(modelId, definition);
  return definition;
}

async function readDirectorySizeBytes(dirPath: string): Promise<number> {
  const cached = directorySizeCache.get(dirPath);
  if (cached !== undefined) return cached;

  let total = 0;
  const queue: string[] = [dirPath];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(fullPath);
        total += stat.size;
      } catch {
        // Ignore transient file read errors.
      }
    }
  }

  directorySizeCache.set(dirPath, total);
  return total;
}

function scoreModelSourceCandidate(
  source: LMStudioModelSource,
  modelId: string,
  apiModel: LMStudioApiModel | undefined
): number {
  const repoToken = normalizeToken(source.repo);
  let score = 0;

  const quantToken = normalizeToken(apiModel?.quantization);
  if (quantToken && repoToken.includes(quantToken)) score += 8;

  const compatibilityToken = normalizeToken(apiModel?.compatibility_type);
  if (compatibilityToken && repoToken.includes(compatibilityToken)) score += 4;

  const [, shortModelName] = modelId.split("/", 2);
  const modelToken = normalizeToken(shortModelName ?? modelId);
  if (modelToken && repoToken.includes(modelToken)) score += 2;

  return score;
}

async function resolveModelsRootDir(): Promise<string> {
  const fromEnv = process.env[LM_STUDIO_MODELS_DIR_ENV]?.trim();
  if (fromEnv) {
    if (fromEnv.startsWith("~")) {
      return path.join(os.homedir(), fromEnv.slice(1));
    }
    return fromEnv;
  }

  const settingsCandidates = [
    path.join(getLMStudioHomeDir(), "settings.json"),
    path.join(os.homedir(), "Library", "Application Support", "LM Studio", "settings.json"),
  ];
  for (const settingsPath of settingsCandidates) {
    try {
      const content = await fs.readFile(settingsPath, "utf8");
      const parsed = JSON.parse(content) as { downloadsFolder?: unknown };
      const downloadsFolder = asNonEmptyString(parsed.downloadsFolder);
      if (downloadsFolder) {
        return downloadsFolder.startsWith("~")
          ? path.join(os.homedir(), downloadsFolder.slice(1))
          : downloadsFolder;
      }
    } catch {
      // Try next location.
    }
  }

  return DEFAULT_LM_STUDIO_MODELS_DIR;
}

async function listImmediateSubdirs(dirPath: string): Promise<string[]> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(dirPath, entry.name));
}

async function findPublisherDirs(rootDir: string, publisher: string): Promise<string[]> {
  const normalizedPublisher = normalizeToken(publisher);
  if (!normalizedPublisher) return [];
  const dirs = await listImmediateSubdirs(rootDir);
  return dirs.filter((dir) => normalizeToken(path.basename(dir)) === normalizedPublisher);
}

function scorePublisherModelCandidate(
  modelDirName: string,
  modelId: string,
  apiModel: LMStudioApiModel | undefined
): number {
  const dirToken = normalizeToken(modelDirName);
  if (!dirToken) return 0;

  let score = 0;
  const idToken = normalizeToken(modelId);
  if (idToken && dirToken.includes(idToken)) score += 24;

  const [, shortModelName] = modelId.split("/", 2);
  const shortToken = normalizeToken(shortModelName ?? modelId);
  if (shortToken && dirToken.includes(shortToken)) score += 16;

  for (const token of tokenizeModelName(shortModelName ?? modelId)) {
    if (dirToken.includes(token)) score += 3;
  }

  const quantToken = normalizeToken(apiModel?.quantization);
  if (quantToken && dirToken.includes(quantToken)) score += 6;

  const compatibilityToken = normalizeToken(apiModel?.compatibility_type);
  if (compatibilityToken && dirToken.includes(compatibilityToken)) score += 4;

  return score;
}

async function resolvePublisherModelMetadata(
  modelId: string,
  apiModel: LMStudioApiModel | undefined,
  modelsRootDir: string
): Promise<{ size: number; parameterSize?: string }> {
  const explicitPublisher = asNonEmptyString(apiModel?.publisher);
  const [publisherFromId] = modelId.split("/", 1);
  const publisher = explicitPublisher ?? publisherFromId;
  if (!publisher) {
    return { size: 0, parameterSize: inferParameterSizeFromModelId(modelId) };
  }

  const bundledModelsDir = path.join(getLMStudioHomeDir(), ".internal", "bundled-models");
  const roots = Array.from(new Set([modelsRootDir, bundledModelsDir]));

  const candidates: Array<{ fullPath: string; score: number }> = [];
  for (const root of roots) {
    const publisherDirs = await findPublisherDirs(root, publisher);
    for (const publisherDir of publisherDirs) {
      const modelDirs = await listImmediateSubdirs(publisherDir);
      if (modelDirs.length === 0) {
        candidates.push({
          fullPath: publisherDir,
          score: scorePublisherModelCandidate(path.basename(publisherDir), modelId, apiModel),
        });
        continue;
      }
      for (const modelDir of modelDirs) {
        candidates.push({
          fullPath: modelDir,
          score: scorePublisherModelCandidate(path.basename(modelDir), modelId, apiModel),
        });
      }
    }
  }

  if (candidates.length === 0) {
    return { size: 0, parameterSize: inferParameterSizeFromModelId(modelId) };
  }

  candidates.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return a.fullPath.localeCompare(b.fullPath);
  });

  let bestSize = 0;
  for (const candidate of candidates) {
    const size = await readDirectorySizeBytes(candidate.fullPath);
    if (size > bestSize) bestSize = size;
    if (size > 0 && candidate.score > 0) {
      return { size, parameterSize: inferParameterSizeFromModelId(modelId) };
    }
  }

  return { size: bestSize, parameterSize: inferParameterSizeFromModelId(modelId) };
}

async function resolveLocalModelMetadata(
  modelId: string,
  apiModel: LMStudioApiModel | undefined,
  modelsRootDir: string
): Promise<{ size: number; parameterSize?: string }> {
  const definition = await loadHubModelDefinition(modelId);
  if (!definition) {
    return resolvePublisherModelMetadata(modelId, apiModel, modelsRootDir);
  }

  const installedSources: Array<LMStudioModelSource & { fullPath: string }> = [];
  for (const source of definition.sources) {
    const fullPath = path.join(modelsRootDir, source.user, source.repo);
    if (await pathIsDirectory(fullPath)) {
      installedSources.push({ ...source, fullPath });
    }
  }

  if (installedSources.length === 0) {
    const fallback = await resolvePublisherModelMetadata(modelId, apiModel, modelsRootDir);
    if (fallback.size > 0) {
      return {
        size: fallback.size,
        parameterSize: definition.parameterSize ?? fallback.parameterSize,
      };
    }
    return { size: 0, parameterSize: definition.parameterSize };
  }

  installedSources.sort((a, b) => {
    const diff =
      scoreModelSourceCandidate(b, modelId, apiModel)
      - scoreModelSourceCandidate(a, modelId, apiModel);
    if (diff !== 0) return diff;
    return a.repo.localeCompare(b.repo);
  });

  let bestSize = 0;
  for (const source of installedSources) {
    const size = await readDirectorySizeBytes(source.fullPath);
    if (size > bestSize) bestSize = size;
    if (size > 0) {
      return { size, parameterSize: definition.parameterSize };
    }
  }

  if (bestSize > 0) {
    return { size: bestSize, parameterSize: definition.parameterSize };
  }

  const fallback = await resolvePublisherModelMetadata(modelId, apiModel, modelsRootDir);
  if (fallback.size > 0) {
    return {
      size: fallback.size,
      parameterSize: definition.parameterSize ?? fallback.parameterSize,
    };
  }

  return { size: 0, parameterSize: definition.parameterSize ?? fallback.parameterSize };
}

function parseSizeBytes(model: LMStudioApiModel | undefined): number {
  if (!model) return 0;
  const candidates = [
    model.size_bytes,
    model.model_size_bytes,
    model.file_size_bytes,
    model.bytes,
    model.size,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) continue;
    if (candidate > 0) return Math.trunc(candidate);
  }
  return 0;
}

function normalizeModelNumber(value: string): string {
  return value.replace(/\.0+$/, "");
}

function inferParameterSizeFromModelId(modelId: string): string | undefined {
  const id = modelId.toLowerCase();

  const mixtureMatch = id.match(/\b(\d+(?:\.\d+)?)\s*[x*]\s*(\d+(?:\.\d+)?)\s*b\b/);
  if (mixtureMatch) {
    const experts = normalizeModelNumber(mixtureMatch[1] ?? "");
    const perExpert = normalizeModelNumber(mixtureMatch[2] ?? "");
    if (experts && perExpert) return `${experts}x${perExpert}B`;
  }

  const billionMatch = id.match(/\b(\d+(?:\.\d+)?)\s*b\b/);
  if (billionMatch?.[1]) {
    return `${normalizeModelNumber(billionMatch[1])}B`;
  }

  const millionMatch = id.match(/\b(\d+(?:\.\d+)?)\s*m\b/);
  if (millionMatch?.[1]) {
    return `${normalizeModelNumber(millionMatch[1])}M`;
  }

  return undefined;
}

function isLoadedState(state: string | undefined): boolean {
  if (!state) return false;
  const normalized = state.trim().toLowerCase();
  if (!normalized || normalized.includes("not-loaded")) return false;
  if (normalized === "loaded" || normalized === "ready") return true;
  return normalized.includes("loaded");
}

async function fetchApiModels(): Promise<LMStudioApiModel[] | null> {
  try {
    const resp = await fetchWithTimeout(
      "/api/v0/models",
      { method: "GET", headers: getLMStudioHeaders() },
      LM_STUDIO_METADATA_TIMEOUT_MS,
      "LM Studio API metadata"
    );
    if (!resp.ok) return null;
    const payload = (await resp.json()) as LMStudioApiModelListResponse;
    return Array.isArray(payload.data) ? payload.data : [];
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  label: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const baseUrl = getLMStudioBaseUrl();
  try {
    const url = new URL(path, baseUrl);
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveLocalLMStudioVersion(): Promise<string | null> {
  const historicalVersionPath = path.join(
    getLMStudioHomeDir(),
    ".internal",
    "historical-version-info.json"
  );
  try {
    const content = await fs.readFile(historicalVersionPath, "utf8");
    const parsed = JSON.parse(content) as LMStudioHistoricalVersionInfo;
    const version =
      asNonEmptyString(parsed.lastRecordedAppVersion)
      ?? asNonEmptyString(parsed.lastRecorderdAppVersion);
    if (!version) return null;
    const build = asNonEmptyString(parsed.lastRecordedAppBuildVersion);
    return build ? `${version}+${build}` : version;
  } catch {
    return null;
  }
}

export async function getLMStudioVersion(): Promise<string> {
  const localVersion = await resolveLocalLMStudioVersion();
  try {
    const resp = await fetchWithTimeout(
      "/v1/models",
      { method: "GET", headers: getLMStudioHeaders() },
      5_000,
      "LM Studio version check"
    );
    if (!resp.ok) return localVersion ?? "unknown";
    const fromHeader = asNonEmptyString(resp.headers.get("x-lmstudio-version"));
    if (fromHeader) return fromHeader;
    return localVersion ?? "unknown";
  } catch {
    return localVersion ?? "unknown";
  }
}

export async function listModels(): Promise<OllamaModel[]> {
  const resp = await fetchWithTimeout(
    "/v1/models",
    { method: "GET", headers: getLMStudioHeaders() },
    LM_STUDIO_INIT_TIMEOUT_MS,
    "LM Studio list models"
  );
  if (!resp.ok) {
    throw new Error(`LM Studio list models failed (${resp.status} ${resp.statusText})`);
  }
  const data = (await resp.json()) as LMStudioModelListResponse;
  const ids = (data.data ?? [])
    .map((m) => m.id?.trim())
    .filter((id): id is string => Boolean(id));

  const apiModels = await fetchApiModels();
  const apiById = new Map<string, LMStudioApiModel>();
  for (const model of apiModels ?? []) {
    const id = asNonEmptyString(model.id);
    if (!id) continue;
    apiById.set(id, model);
  }

  const modelsRootDir = await resolveModelsRootDir();
  const localMetadataById = new Map<string, { size: number; parameterSize?: string }>();
  for (const id of ids) {
    const localMetadata = await resolveLocalModelMetadata(id, apiById.get(id), modelsRootDir);
    localMetadataById.set(id, localMetadata);
  }

  return ids.map((id) => {
    const apiModel = apiById.get(id);
    const localMetadata = localMetadataById.get(id);
    const apiSize = parseSizeBytes(apiModel);
    return {
      name: id,
      size: apiSize > 0 ? apiSize : (localMetadata?.size ?? 0),
      parameterSize:
        localMetadata?.parameterSize
        ?? inferParameterSizeFromModelId(id),
      quantization: asNonEmptyString(apiModel?.quantization),
      runtimeStatus: asNonEmptyString(apiModel?.state),
      modelFormat: asNonEmptyString(apiModel?.compatibility_type),
      family:
        asNonEmptyString(apiModel?.arch)
        ?? asNonEmptyString(apiModel?.type)
        ?? asNonEmptyString(apiModel?.publisher),
    };
  });
}

export async function listRunningModels(): Promise<OllamaRunningModel[]> {
  const apiModels = await fetchApiModels();
  if (!apiModels) return [];

  return apiModels
    .filter((model) => isLoadedState(model.state))
    .map((model) => ({
      name: model.id ?? "",
      size: parseSizeBytes(model),
      vramUsed: 0,
    }))
    .filter((model) => model.name.trim().length > 0);
}

export function setDefaultKeepAlive(keepAlive?: KeepAliveValue): void {
  // No-op for LM Studio today (kept for runtime interface parity).
  defaultKeepAlive = keepAlive;
  void defaultKeepAlive;
}

export async function generate(
  model: string,
  prompt: string,
  options?: LMStudioRequestOptions
): Promise<GenerateResult> {
  const start = Date.now();
  const controller = new AbortController();
  activeAbortControllers.add(controller);
  try {
    const baseUrl = getLMStudioBaseUrl();
    const url = new URL("/v1/chat/completions", baseUrl);
    const doRequest = (includeSampling: boolean) =>
      fetch(url, {
        method: "POST",
        headers: getLMStudioHeaders(),
        body: JSON.stringify(buildChatCompletionBody(model, prompt, options, false, includeSampling)),
        signal: controller.signal,
      });

    let resp = await doRequest(true);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      if (hasSamplingOverrides(options) && isUnsupportedSamplingMessage(resp.status, body)) {
        resp = await doRequest(false);
      } else {
        throw buildLMStudioRequestError("generate", model, resp.status, resp.statusText, body);
      }
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw buildLMStudioRequestError("generate", model, resp.status, resp.statusText, body);
    }

    const payload = (await resp.json()) as LMStudioChatCompletionChunk;
    const choice = extractChoice(payload);
    const response = extractContent(choice);
    const reasoning = extractReasoning(choice);
    assertThinkingModeRespected(model, options?.think, response, reasoning);
    const usage = extractUsage(payload);
    const totalDuration = Math.max(0, Date.now() - start) * 1e6;

    // Non-streaming: we cannot separate prompt processing from generation,
    // so evalDuration falls back to totalDuration. This path is only used
    // by quality benchmarks (not tok/s measurement). The streaming path
    // (generateStream) uses first/last token timing for accurate evalDuration.
    return {
      response,
      ...(reasoning ? { thinking: reasoning } : {}),
      totalDuration,
      loadDuration: 0,
      promptEvalCount: getUsageTokenCount(usage?.prompt_tokens),
      promptEvalDuration: 0,
      evalCount: resolveCompletionTokenCount(usage, response, reasoning),
      evalDuration: totalDuration,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("LM Studio generate request aborted");
    }
    throw err;
  } finally {
    activeAbortControllers.delete(controller);
  }
}

export async function generateStream(
  model: string,
  prompt: string,
  callbacks?: StreamCallbacks,
  options?: LMStudioRequestOptions
): Promise<GenerateResult> {
  const start = Date.now();
  const controller = new AbortController();
  activeAbortControllers.add(controller);
  const stallTimeoutMs = resolveStreamStallTimeoutMs(options?.stall_timeout_ms);
  let abortedByStallTimeout = false;

  const baseUrl = getLMStudioBaseUrl();
  const url = new URL("/v1/chat/completions", baseUrl);

  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const resetStallTimer = () => {
    if (stallTimeoutMs === undefined) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      abortedByStallTimeout = true;
      controller.abort();
    }, stallTimeoutMs);
  };

  try {
    resetStallTimer();

    const doRequest = (includeSampling: boolean) =>
      fetch(url, {
        method: "POST",
        headers: getLMStudioHeaders(),
        body: JSON.stringify(buildChatCompletionBody(model, prompt, options, true, includeSampling)),
        signal: controller.signal,
      });

    let resp = await doRequest(true);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      if (hasSamplingOverrides(options) && isUnsupportedSamplingMessage(resp.status, body)) {
        resp = await doRequest(false);
      } else {
        throw buildLMStudioRequestError("stream", model, resp.status, resp.statusText, body);
      }
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw buildLMStudioRequestError("stream", model, resp.status, resp.statusText, body);
    }

    if (!resp.body) {
      throw new Error("LM Studio stream response body is empty");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let doneReceived = false;
    let fullResponse = "";
    let fullThinking = "";
    let usage: LMStudioUsage | undefined;
    let firstChunkSeen = false;
    let firstGeneratedTokenTime: number | null = null;
    let lastGeneratedTokenTime: number | null = null;

    const processDataLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) return;
      const dataStr = line.slice(5).trim();
      if (!dataStr) return;
      if (dataStr === "[DONE]") {
        doneReceived = true;
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(dataStr);
      } catch {
        return;
      }

      const choice = extractChoice(payload);
      const content = extractContent(choice);
      const reasoning = extractReasoning(choice);
      const chunkUsage = extractUsage(payload);
      if (chunkUsage) usage = chunkUsage;

      if (reasoning || content) {
        const now = Date.now();
        if (firstGeneratedTokenTime === null) firstGeneratedTokenTime = now;
        lastGeneratedTokenTime = now;
      }
      if (reasoning) {
        fullThinking += reasoning;
      }
      if (content) {
        fullResponse += content;
        callbacks?.onToken?.(content);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetStallTimer();
      if (!firstChunkSeen) {
        firstChunkSeen = true;
        callbacks?.onFirstChunk?.();
      }
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const rawLine of lines) {
        processDataLine(rawLine);
      }
    }

    if (buffered.trim().length > 0) {
      processDataLine(buffered);
    }

    if (stallTimer) clearTimeout(stallTimer);

    if (!doneReceived && !fullResponse && !fullThinking) {
      throw new Error("LM Studio stream ended without content");
    }

    const totalDuration = Math.max(0, Date.now() - start) * 1e6;
    // evalDuration = time between first and last generated token (reasoning/content).
    // Falls back to totalDuration when we couldn't track a token window.
    const evalDurationMs =
      firstGeneratedTokenTime !== null
      && lastGeneratedTokenTime !== null
      && lastGeneratedTokenTime > firstGeneratedTokenTime
        ? lastGeneratedTokenTime - firstGeneratedTokenTime
        : Date.now() - start;
    const result: GenerateResult = {
      response: fullResponse,
      ...(fullThinking ? { thinking: fullThinking } : {}),
      totalDuration,
      loadDuration: 0,
      promptEvalCount: getUsageTokenCount(usage?.prompt_tokens),
      promptEvalDuration: firstGeneratedTokenTime !== null ? (firstGeneratedTokenTime - start) * 1e6 : 0,
      evalCount: resolveCompletionTokenCount(usage, fullResponse, fullThinking),
      evalDuration: Math.max(1, evalDurationMs) * 1e6,
    };
    assertThinkingModeRespected(model, options?.think, fullResponse, fullThinking);

    callbacks?.onDone?.(result);
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (abortedByStallTimeout && stallTimeoutMs !== undefined) {
        throw new Error(`LM Studio stream timed out after ${stallTimeoutMs}ms`);
      }
      throw new Error("LM Studio stream request aborted");
    }
    throw err;
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    activeAbortControllers.delete(controller);
  }
}

export async function unloadModel(_model: string): Promise<void> {
  // No-op for LM Studio today.
}

export function abortOngoingRequests(): void {
  for (const controller of activeAbortControllers) {
    controller.abort();
  }
  activeAbortControllers.clear();
}
