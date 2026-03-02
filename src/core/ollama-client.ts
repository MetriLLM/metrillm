import { Ollama } from "ollama";
import type { OllamaModel, OllamaRunningModel } from "../types.js";
import { withTimeout } from "../utils.js";

const client = new Ollama();
const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
const OLLAMA_INIT_TIMEOUT_MS = 15_000;
const STREAM_STALL_TIMEOUT_MS = 30_000;

function getOllamaBaseUrl(): string {
  const configured = process.env.OLLAMA_HOST?.trim();
  if (!configured) return DEFAULT_OLLAMA_HOST;
  const candidate = /^https?:\/\//i.test(configured) ? configured : `http://${configured}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return DEFAULT_OLLAMA_HOST;
  }
}

export async function getOllamaVersion(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const baseUrl = getOllamaBaseUrl();
    const url = new URL("/api/version", baseUrl);
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return "unknown";
    const data = (await resp.json()) as { version?: string };
    return data.version ?? "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timeout);
  }
}

export async function listModels(): Promise<OllamaModel[]> {
  const resp = await withTimeout(client.list(), OLLAMA_INIT_TIMEOUT_MS, "Ollama list models");
  return resp.models.map((m) => ({
    name: m.name,
    size: m.size,
    parameterSize: m.details?.parameter_size,
    quantization: m.details?.quantization_level,
    family: m.details?.family,
  }));
}

export async function listRunningModels(): Promise<OllamaRunningModel[]> {
  const resp = await withTimeout(client.ps(), OLLAMA_INIT_TIMEOUT_MS, "Ollama list running models");
  return resp.models.map((m) => ({
    name: m.name,
    size: m.size,
    vramUsed: m.size_vram,
  }));
}

export interface GenerateResult {
  response: string;
  thinking?: string;
  totalDuration: number; // ns
  loadDuration: number; // ns
  promptEvalCount: number;
  promptEvalDuration: number; // ns
  evalCount: number;
  evalDuration: number; // ns
}

export type KeepAliveValue = string | number;

let defaultKeepAlive: KeepAliveValue | undefined;

export function setDefaultKeepAlive(keepAlive?: KeepAliveValue): void {
  defaultKeepAlive = keepAlive;
}

export async function generate(
  model: string,
  prompt: string,
  options?: { temperature?: number; num_predict?: number; keep_alive?: KeepAliveValue; think?: boolean }
): Promise<GenerateResult> {
  return generateStream(model, prompt, undefined, options);
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onDone?: (result: GenerateResult) => void;
}

export async function generateStream(
  model: string,
  prompt: string,
  callbacks?: StreamCallbacks,
  options?: { temperature?: number; num_predict?: number; keep_alive?: KeepAliveValue; think?: boolean }
): Promise<GenerateResult> {
  const stream = await withTimeout(
    client.generate({
      model,
      prompt,
      stream: true,
      keep_alive: options?.keep_alive ?? defaultKeepAlive,
      ...(options?.think ? { think: true } : {}),
      options: {
        temperature: options?.temperature ?? 0,
        num_predict: options?.num_predict ?? 512,
      },
    }),
    OLLAMA_INIT_TIMEOUT_MS,
    "Ollama generate initialization"
  );

  let fullResponse = "";
  let fullThinking = "";
  let result: GenerateResult | null = null;

  // Stall detection: abort if no chunk arrives within STREAM_STALL_TIMEOUT_MS
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const resetStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      client.abort();
    }, STREAM_STALL_TIMEOUT_MS);
  };

  try {
    resetStallTimer();
    for await (const chunk of stream) {
      resetStallTimer();
      const chunkAny = chunk as unknown as Record<string, unknown>;
      if (chunkAny.thinking) {
        fullThinking += String(chunkAny.thinking);
      }
      if (chunk.response) {
        fullResponse += chunk.response;
        callbacks?.onToken?.(chunk.response);
      }
      if (chunk.done) {
        result = {
          response: fullResponse,
          ...(fullThinking ? { thinking: fullThinking } : {}),
          totalDuration: chunk.total_duration ?? 0,
          loadDuration: chunk.load_duration ?? 0,
          promptEvalCount: chunk.prompt_eval_count ?? 0,
          promptEvalDuration: chunk.prompt_eval_duration ?? 0,
          evalCount: chunk.eval_count ?? 0,
          evalDuration: chunk.eval_duration ?? 0,
        };
      }
    }
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }

  if (!result) {
    throw new Error("Stream ended without done signal");
  }

  callbacks?.onDone?.(result);
  return result;
}

export async function unloadModel(model: string): Promise<void> {
  await withTimeout(
    client.generate({
      model,
      prompt: "",
      stream: false,
      keep_alive: 0,
      options: {
        temperature: 0,
        num_predict: 0,
      },
    }),
    OLLAMA_INIT_TIMEOUT_MS,
    "Ollama unload model"
  );
}

export function abortOngoingRequests(): void {
  client.abort();
}
