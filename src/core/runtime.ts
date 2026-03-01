import type { OllamaModel, OllamaRunningModel } from "../types.js";
import type { GenerateResult, KeepAliveValue, StreamCallbacks } from "./ollama-client.js";
import * as ollamaClient from "./ollama-client.js";

export interface GenerateOptions {
  temperature?: number;
  num_predict?: number;
  keep_alive?: KeepAliveValue;
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

let activeRuntime: LLMRuntime = new OllamaRuntime();

export function getRuntime(): LLMRuntime {
  return activeRuntime;
}

export function setRuntime(runtime: LLMRuntime): void {
  activeRuntime = runtime;
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
