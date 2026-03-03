import type { GenerateOptions } from "../core/runtime.js";
import type { BenchmarkProfileMetadata } from "../types.js";

export const BENCHMARK_PROFILE_VERSION = "v1";
export const BENCHMARK_PROFILE_SEED = 42;
export const BENCHMARK_PROFILE_TOP_P = 1;
export const BENCHMARK_PROFILE_TEMPERATURE = 0;

export function withBenchmarkProfile(
  opts: Omit<GenerateOptions, "temperature" | "top_p" | "seed"> = {}
): GenerateOptions {
  return {
    temperature: BENCHMARK_PROFILE_TEMPERATURE,
    top_p: BENCHMARK_PROFILE_TOP_P,
    seed: BENCHMARK_PROFILE_SEED,
    ...opts,
  };
}

export function buildBenchmarkProfileMetadata(thinkEnabled: boolean): BenchmarkProfileMetadata {
  return {
    version: BENCHMARK_PROFILE_VERSION,
    sampling: {
      temperature: BENCHMARK_PROFILE_TEMPERATURE,
      topP: BENCHMARK_PROFILE_TOP_P,
      seed: BENCHMARK_PROFILE_SEED,
    },
    thinkingMode: thinkEnabled ? "enabled" : "disabled",
    contextWindowTokens: null,
    contextPolicy: "runtime-default",
  };
}
