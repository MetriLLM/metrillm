import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BenchResult } from "../types.js";

const SUPABASE_URL_PLACEHOLDER = "https://YOUR_SUPABASE_PROJECT.supabase.co";
const SUPABASE_ANON_KEY_PLACEHOLDER = "YOUR_SUPABASE_ANON_KEY";
const PUBLIC_RESULT_BASE_URL_PLACEHOLDER = "https://YOUR_DASHBOARD_DOMAIN";

function resolveUploaderConfig(): {
  supabaseUrl: string;
  supabaseAnonKey: string;
  publicResultBaseUrl: string;
} {
  return {
    supabaseUrl: process.env.LLMETER_SUPABASE_URL ?? SUPABASE_URL_PLACEHOLDER,
    supabaseAnonKey: process.env.LLMETER_SUPABASE_ANON_KEY ?? SUPABASE_ANON_KEY_PLACEHOLDER,
    publicResultBaseUrl:
      process.env.LLMETER_PUBLIC_RESULT_BASE_URL ?? PUBLIC_RESULT_BASE_URL_PLACEHOLDER,
  };
}

function hasPlaceholder(value: string): boolean {
  return value.includes("YOUR_");
}

function assertUploaderConfig(config: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  publicResultBaseUrl: string;
}): void {
  const missing: string[] = [];
  if (hasPlaceholder(config.supabaseUrl)) missing.push("LLMETER_SUPABASE_URL");
  if (hasPlaceholder(config.supabaseAnonKey)) missing.push("LLMETER_SUPABASE_ANON_KEY");
  if (hasPlaceholder(config.publicResultBaseUrl)) missing.push("LLMETER_PUBLIC_RESULT_BASE_URL");
  if (missing.length > 0) {
    throw new Error(
      `Upload is not configured. Set these variables first: ${missing.join(", ")}`
    );
  }
}

export interface UploadResult {
  id: string;
  url: string;
  rankGlobalPct: number | null;   // e.g. 15 = top 15%
  rankCpuPct: number | null;      // e.g. 8 = top 8% on same CPU
  totalCount: number;
}

export interface UploadBenchOptions {
  submitterEmail?: string;
}

export async function uploadBenchResult(
  result: BenchResult,
  options: UploadBenchOptions = {}
): Promise<UploadResult> {
  const config = resolveUploaderConfig();
  assertUploaderConfig(config);
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  const row = {
    model: result.model,
    parameter_size: result.modelInfo?.parameterSize ?? null,
    quantization: result.modelInfo?.quantization ?? null,
    family: result.modelInfo?.family ?? null,
    thinking_detected: result.modelInfo?.thinkingDetected ?? null,
    tokens_per_second: result.performance.tokensPerSecond,
    ttft_ms: result.performance.ttft,
    memory_percent: result.performance.memoryHostPercent ?? result.performance.memoryPercent,
    thinking_tokens_estimate: result.performance.thinkingTokensEstimate ?? null,
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
    machine_model: result.hardware.machineModel ?? null,
    power_mode: result.hardware.powerMode ?? null,
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
  const url = `${config.publicResultBaseUrl.replace(/\/+$/, "")}/result/${id}`;

  await upsertLeadBestEffort(
    supabase,
    options.submitterEmail,
    result.submitter?.nickname ?? null,
    result.submitter?.emailHash ?? null
  );

  const rank = await getRank(
    supabase,
    result.fitness.globalScore,
    result.hardware.cpu
  );
  return { id, url, ...rank };
}

async function upsertLeadBestEffort(
  supabase: SupabaseClient,
  email: string | undefined,
  nickname: string | null,
  emailHash: string | null
): Promise<void> {
  if (!email || !emailHash) return;

  try {
    const { error } = await supabase
      .from("benchmark_leads")
      .upsert(
        {
          email,
          email_hash: emailHash,
          nickname,
          source: "cli",
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "email_hash" }
      );

    if (error) {
      throw error;
    }
  } catch {
    // Lead collection is best-effort and must not block benchmark uploads.
  }
}

async function getRank(
  supabase: SupabaseClient,
  globalScore: number | null,
  cpu: string
): Promise<{ rankGlobalPct: number | null; rankCpuPct: number | null; totalCount: number }> {
  if (globalScore == null) {
    return { rankGlobalPct: null, rankCpuPct: null, totalCount: 0 };
  }

  try {
    const [
      { count: totalCount },
      { count: betterCount },
      { count: cpuTotal },
      { count: cpuBetter },
    ] = await Promise.all([
      supabase.from("benchmarks").select("*", { count: "exact", head: true }),
      supabase.from("benchmarks").select("*", { count: "exact", head: true }).gt("global_score", globalScore),
      supabase.from("benchmarks").select("*", { count: "exact", head: true }).eq("cpu", cpu),
      supabase.from("benchmarks").select("*", { count: "exact", head: true }).eq("cpu", cpu).gt("global_score", globalScore),
    ]);

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
