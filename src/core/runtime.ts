import type { OllamaModel, OllamaRunningModel } from "../types.js";
import type { GenerateResult, StreamCallbacks } from "./ollama-client.js";
import * as ollamaClient from "./ollama-client.js";

export interface GenerateOptions {
  temperature?: number;
  num_predict?: number;
}

export interface LLMRuntime {
  name: string;
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
  abort(): void;
}

class OllamaRuntime implements LLMRuntime {
  name = "ollama";

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

export function abortOngoingRequests(): void {
  activeRuntime.abort();
}

// Re-export types from ollama-client for convenience
export type { GenerateResult, StreamCallbacks } from "./ollama-client.js";
