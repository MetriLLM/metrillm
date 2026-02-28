import { Ollama } from "ollama";
import type { OllamaModel, OllamaRunningModel } from "../types.js";

const client = new Ollama();

export async function getOllamaVersion(): Promise<string> {
  try {
    const resp = await fetch("http://127.0.0.1:11434/api/version");
    const data = (await resp.json()) as { version?: string };
    return data.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function listModels(): Promise<OllamaModel[]> {
  const resp = await client.list();
  return resp.models.map((m) => ({
    name: m.name,
    size: m.size,
    parameterSize: m.details?.parameter_size,
    quantization: m.details?.quantization_level,
    family: m.details?.family,
  }));
}

export async function listRunningModels(): Promise<OllamaRunningModel[]> {
  const resp = await client.ps();
  return resp.models.map((m) => ({
    name: m.name,
    size: m.size,
    vramUsed: m.size_vram,
  }));
}

export interface GenerateResult {
  response: string;
  totalDuration: number; // ns
  loadDuration: number; // ns
  promptEvalCount: number;
  promptEvalDuration: number; // ns
  evalCount: number;
  evalDuration: number; // ns
}

export async function generate(
  model: string,
  prompt: string,
  options?: { temperature?: number; num_predict?: number }
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
  options?: { temperature?: number; num_predict?: number }
): Promise<GenerateResult> {
  const stream = await client.generate({
    model,
    prompt,
    stream: true,
    options: {
      temperature: options?.temperature ?? 0,
      num_predict: options?.num_predict ?? 512,
    },
  });

  let fullResponse = "";
  let result: GenerateResult | null = null;

  for await (const chunk of stream) {
    if (chunk.response) {
      fullResponse += chunk.response;
      callbacks?.onToken?.(chunk.response);
    }
    if (chunk.done) {
      result = {
        response: fullResponse,
        totalDuration: chunk.total_duration ?? 0,
        loadDuration: chunk.load_duration ?? 0,
        promptEvalCount: chunk.prompt_eval_count ?? 0,
        promptEvalDuration: chunk.prompt_eval_duration ?? 0,
        evalCount: chunk.eval_count ?? 0,
        evalDuration: chunk.eval_duration ?? 0,
      };
    }
  }

  if (!result) {
    throw new Error("Stream ended without done signal");
  }

  callbacks?.onDone?.(result);
  return result;
}

export function abortOngoingRequests(): void {
  client.abort();
}
