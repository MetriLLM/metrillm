import type { OllamaModel, OllamaRunningModel } from "../types.js";
import type { GenerateResult, KeepAliveValue, StreamCallbacks } from "./ollama-client.js";
import * as ollamaClient from "./ollama-client.js";
import * as lmStudioClient from "./lm-studio-client.js";

export interface GenerateOptions {
  temperature?: number;
  top_p?: number;
  seed?: number;
  num_predict?: number;
  keep_alive?: KeepAliveValue;
  think?: boolean;
  stall_timeout_ms?: number;
}

export interface LLMRuntime {
  name: string;
  modelFormat?: string; // default "gguf"
  generate(model: string, prompt: string, opts?: GenerateOptions): Promise<GenerateResult>;
  generateStream(
    model: string,
    prompt: string,
    callbacks?: StreamCallbacks,
    opts?: GenerateOptions
  ): Promise<GenerateResult>;
  listModels(): Promise<OllamaModel[]>;
  listRunningModels(): Promise<OllamaRunningModel[]>;
  getVersion(): Promise<string>;
  unloadModel(model: string): Promise<void>;
  setKeepAlive(keepAlive?: KeepAliveValue): void;
  abort(): void;
}

export const SUPPORTED_RUNTIME_BACKENDS = ["ollama", "lm-studio"] as const;
export type RuntimeBackend = (typeof SUPPORTED_RUNTIME_BACKENDS)[number];

const RUNTIME_LABELS: Record<RuntimeBackend, string> = {
  ollama: "Ollama",
  "lm-studio": "LM Studio",
};

class OllamaRuntime implements LLMRuntime {
  name = "ollama";
  modelFormat = "gguf";

  generate(model: string, prompt: string, opts?: GenerateOptions): Promise<GenerateResult> {
    return ollamaClient.generate(model, prompt, opts);
  }

  generateStream(
    model: string,
    prompt: string,
    callbacks?: StreamCallbacks,
    opts?: GenerateOptions
  ): Promise<GenerateResult> {
    return ollamaClient.generateStream(model, prompt, callbacks, opts);
  }

  listModels(): Promise<OllamaModel[]> {
    return ollamaClient.listModels();
  }

  listRunningModels(): Promise<OllamaRunningModel[]> {
    return ollamaClient.listRunningModels();
  }

  getVersion(): Promise<string> {
    return ollamaClient.getOllamaVersion();
  }

  unloadModel(model: string): Promise<void> {
    return ollamaClient.unloadModel(model);
  }

  setKeepAlive(keepAlive?: KeepAliveValue): void {
    ollamaClient.setDefaultKeepAlive(keepAlive);
  }

  abort(): void {
    ollamaClient.abortOngoingRequests();
  }
}

class LMStudioRuntime implements LLMRuntime {
  name: RuntimeBackend = "lm-studio";
  modelFormat = "gguf";

  generate(model: string, prompt: string, opts?: GenerateOptions): Promise<GenerateResult> {
    return lmStudioClient.generate(model, prompt, opts);
  }

  generateStream(
    model: string,
    prompt: string,
    callbacks?: StreamCallbacks,
    opts?: GenerateOptions
  ): Promise<GenerateResult> {
    return lmStudioClient.generateStream(model, prompt, callbacks, opts);
  }

  listModels(): Promise<OllamaModel[]> {
    return lmStudioClient.listModels();
  }

  listRunningModels(): Promise<OllamaRunningModel[]> {
    return lmStudioClient.listRunningModels();
  }

  getVersion(): Promise<string> {
    return lmStudioClient.getLMStudioVersion();
  }

  unloadModel(model: string): Promise<void> {
    return lmStudioClient.unloadModel(model);
  }

  setKeepAlive(keepAlive?: KeepAliveValue): void {
    lmStudioClient.setDefaultKeepAlive(keepAlive);
  }

  abort(): void {
    lmStudioClient.abortOngoingRequests();
  }
}

let activeRuntime: LLMRuntime = new OllamaRuntime();

function createRuntime(backend: RuntimeBackend): LLMRuntime {
  if (backend === "lm-studio") return new LMStudioRuntime();
  return new OllamaRuntime();
}

export function normalizeRuntimeBackend(value?: string): RuntimeBackend {
  const candidate = (value ?? "ollama").trim().toLowerCase();
  if (candidate === "ollama" || candidate === "lm-studio") {
    return candidate;
  }
  throw new Error(
    `Unsupported backend "${value}". Supported backends: ${SUPPORTED_RUNTIME_BACKENDS.join(", ")}`
  );
}

export function setRuntimeByName(backend?: string): RuntimeBackend {
  const normalized = normalizeRuntimeBackend(backend);
  if (activeRuntime.name === normalized) return normalized;
  activeRuntime = createRuntime(normalized);
  return normalized;
}

export function getRuntime(): LLMRuntime {
  return activeRuntime;
}

export function setRuntime(runtime: LLMRuntime): void {
  activeRuntime = runtime;
}

export function getRuntimeDisplayName(runtimeName: string = activeRuntime.name): string {
  if (runtimeName === "lm-studio") return RUNTIME_LABELS["lm-studio"];
  if (runtimeName === "ollama") return RUNTIME_LABELS.ollama;
  return runtimeName;
}

export function getRuntimeModelInstallHint(runtimeName: string = activeRuntime.name): string {
  if (runtimeName === "lm-studio") {
    return "Download/select a model in LM Studio, then load it in the local server.";
  }
  if (runtimeName === "ollama") {
    return "Pull one with: ollama pull <model>";
  }
  return "Add at least one model in your selected runtime.";
}

export function getRuntimeSetupHints(runtimeName: string = activeRuntime.name): string[] {
  if (runtimeName === "lm-studio") {
    return [
      "Start LM Studio local server (Developer tab -> Local Server).",
      "Optionally set LM_STUDIO_BASE_URL if your server is not on http://127.0.0.1:1234.",
    ];
  }
  if (runtimeName === "ollama") {
    return [
      "Start it with:  ollama serve",
      "Install it at:  https://ollama.com",
    ];
  }
  return ["Verify the runtime is reachable and configured correctly."];
}

// ── Proxy exports (drop-in replacements for ollama-client imports) ──

export function generate(
  model: string,
  prompt: string,
  opts?: GenerateOptions
): Promise<GenerateResult> {
  return activeRuntime.generate(model, prompt, opts);
}

export function generateStream(
  model: string,
  prompt: string,
  callbacks?: StreamCallbacks,
  opts?: GenerateOptions
): Promise<GenerateResult> {
  return activeRuntime.generateStream(model, prompt, callbacks, opts);
}

export function listModels(): Promise<OllamaModel[]> {
  return activeRuntime.listModels();
}

export function listRunningModels(): Promise<OllamaRunningModel[]> {
  return activeRuntime.listRunningModels();
}

export function getRuntimeVersion(): Promise<string> {
  return activeRuntime.getVersion();
}

export function unloadModel(model: string): Promise<void> {
  return activeRuntime.unloadModel(model);
}

export function setRuntimeKeepAlive(keepAlive?: KeepAliveValue): void {
  activeRuntime.setKeepAlive(keepAlive);
}

export function abortOngoingRequests(): void {
  activeRuntime.abort();
}

export function getRuntimeName(): string {
  return activeRuntime.name;
}

export function getRuntimeModelFormat(): string {
  return activeRuntime.modelFormat ?? "gguf";
}

// Re-export types from ollama-client for convenience
export type { GenerateResult, KeepAliveValue, StreamCallbacks } from "./ollama-client.js";
