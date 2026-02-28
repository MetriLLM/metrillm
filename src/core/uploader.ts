import { createClient } from "@supabase/supabase-js";
import type { BenchResult } from "../types.js";

const SUPABASE_URL = "https://YOUR_SUPABASE_PROJECT.supabase.co";
const SUPABASE_ANON_KEY =
  "YOUR_SUPABASE_ANON_KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface UploadResult {
  id: string;
  url: string;
}

export async function uploadBenchResult(result: BenchResult): Promise<UploadResult> {
  const row = {
    model: result.model,
    parameter_size: result.modelInfo?.parameterSize ?? null,
    quantization: result.modelInfo?.quantization ?? null,
    family: result.modelInfo?.family ?? null,
    tokens_per_second: result.performance.tokensPerSecond,
    ttft_ms: result.performance.ttft,
    memory_percent: result.performance.memoryHostPercent ?? result.performance.memoryPercent,
    verdict: result.fitness.verdict,
    global_score: result.fitness.globalScore,
    hardware_fit_score: result.fitness.hardwareFitScore,
    quality_score: result.fitness.qualityScore?.total ?? null,
    cpu: result.hardware.cpu,
    cpu_cores: result.hardware.cpuCores,
    total_memory_gb: result.hardware.totalMemoryGB,
    gpu: result.hardware.gpu || null,
    os: result.hardware.os,
    arch: result.hardware.arch,
    benchmark_spec_version: result.metadata.benchmarkSpecVersion,
    runtime_version: result.metadata.runtimeVersion,
    raw_log_hash: result.metadata.rawLogHash,
    result: result,
  };

  const { data, error } = await supabase
    .from("benchmarks")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Unique constraint violation on raw_log_hash = duplicate upload
      throw new Error("This benchmark result has already been uploaded.");
    }
    throw new Error(`Upload failed: ${error.message}`);
  }

  const id = data.id as string;
  const url = `https://metrillm.dev/result/${id}`;

  return { id, url };
}
