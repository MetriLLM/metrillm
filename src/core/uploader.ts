import { createClient } from "@supabase/supabase-js";
import type { BenchResult } from "../types.js";

const SUPABASE_URL =
  process.env.LLMETER_SUPABASE_URL ?? "https://YOUR_SUPABASE_PROJECT.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.LLMETER_SUPABASE_ANON_KEY ??
  "YOUR_SUPABASE_ANON_KEY";
const PUBLIC_RESULT_BASE_URL =
  process.env.LLMETER_PUBLIC_RESULT_BASE_URL ?? "https://metrillm.dev";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface UploadResult {
  id: string;
  url: string;
  rankGlobalPct: number | null;   // e.g. 15 = top 15%
  rankCpuPct: number | null;      // e.g. 8 = top 8% on same CPU
  totalCount: number;
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
  const url = `${PUBLIC_RESULT_BASE_URL.replace(/\/+$/, "")}/result/${id}`;

  const rank = await getRank(result.fitness.globalScore, result.hardware.cpu);
  return { id, url, ...rank };
}

async function getRank(
  globalScore: number | null,
  cpu: string
): Promise<{ rankGlobalPct: number | null; rankCpuPct: number | null; totalCount: number }> {
  if (globalScore == null) {
    return { rankGlobalPct: null, rankCpuPct: null, totalCount: 0 };
  }

  try {
    // Global rank
    const { count: totalCount } = await supabase
      .from("benchmarks")
      .select("*", { count: "exact", head: true });

    const { count: betterCount } = await supabase
      .from("benchmarks")
      .select("*", { count: "exact", head: true })
      .gt("global_score", globalScore);

    // CPU-specific rank
    const { count: cpuTotal } = await supabase
      .from("benchmarks")
      .select("*", { count: "exact", head: true })
      .eq("cpu", cpu);

    const { count: cpuBetter } = await supabase
      .from("benchmarks")
      .select("*", { count: "exact", head: true })
      .eq("cpu", cpu)
      .gt("global_score", globalScore);

    const total = totalCount ?? 0;
    const rankGlobalPct =
      total > 0 ? Math.max(1, Math.round(((betterCount ?? 0) + 1) / total * 100)) : null;
    const cpuTotalN = cpuTotal ?? 0;
    const rankCpuPct =
      cpuTotalN > 0 ? Math.max(1, Math.round(((cpuBetter ?? 0) + 1) / cpuTotalN * 100)) : null;

    return { rankGlobalPct, rankCpuPct, totalCount: total };
  } catch {
    return { rankGlobalPct: null, rankCpuPct: null, totalCount: 0 };
  }
}
