import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BenchResult } from "../types.js";

const SUPABASE_URL_DEFAULT = "https://phvvzbgasxobjzjnkewf.supabase.co";
// Public anon key for the official read/insert-only leaderboard project (RLS enforced).
const SUPABASE_ANON_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBodnZ6Ymdhc3hvYmp6am5rZXdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyOTMxNTksImV4cCI6MjA4Nzg2OTE1OX0.-Wn0V8f-Uv_x_krNUnjmFRcqfAOPQEVc_Qx1kZ2ppgk";
const SUPABASE_URL_PLACEHOLDER = "https://YOUR_SUPABASE_PROJECT.supabase.co";
const SUPABASE_URL_PLACEHOLDER_ALT = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY_PLACEHOLDER = "YOUR_SUPABASE_ANON_KEY";
const SUPABASE_ANON_KEY_PLACEHOLDER_ALT = "your-supabase-anon-key";
const PUBLIC_RESULT_BASE_URL_DEFAULT = "https://metrillm.dev";
const PUBLIC_RESULT_BASE_URL_PLACEHOLDER = "https://YOUR_DASHBOARD_DOMAIN";
const PUBLIC_RESULT_BASE_URL_PLACEHOLDER_ALT = "https://your-dashboard-domain";

function resolveUploaderConfig(): {
  supabaseUrl: string;
  supabaseAnonKey: string;
  publicResultBaseUrl: string;
} {
  const configuredPublicBaseUrl = process.env.METRILLM_PUBLIC_RESULT_BASE_URL?.trim();
  const publicResultBaseUrl =
    !configuredPublicBaseUrl || hasPlaceholder(configuredPublicBaseUrl)
      ? PUBLIC_RESULT_BASE_URL_DEFAULT
      : configuredPublicBaseUrl;

  return {
    supabaseUrl:
      !process.env.METRILLM_SUPABASE_URL || hasPlaceholder(process.env.METRILLM_SUPABASE_URL)
        ? SUPABASE_URL_DEFAULT
        : process.env.METRILLM_SUPABASE_URL,
    supabaseAnonKey:
      !process.env.METRILLM_SUPABASE_ANON_KEY || hasPlaceholder(process.env.METRILLM_SUPABASE_ANON_KEY)
        ? SUPABASE_ANON_KEY_DEFAULT
        : process.env.METRILLM_SUPABASE_ANON_KEY,
    publicResultBaseUrl,
  };
}

function hasPlaceholder(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) return true;
  return [
    SUPABASE_URL_PLACEHOLDER,
    SUPABASE_URL_PLACEHOLDER_ALT,
    SUPABASE_ANON_KEY_PLACEHOLDER,
    SUPABASE_ANON_KEY_PLACEHOLDER_ALT,
    PUBLIC_RESULT_BASE_URL_PLACEHOLDER,
    PUBLIC_RESULT_BASE_URL_PLACEHOLDER_ALT,
  ].some((placeholder) => placeholder.toLowerCase() === normalized.toLowerCase());
}

function assertUploaderConfig(config: {
  supabaseUrl: string;
  supabaseAnonKey: string;
}): void {
  const missing: string[] = [];
  if (!config.supabaseUrl.trim()) missing.push("METRILLM_SUPABASE_URL");
  if (!config.supabaseAnonKey.trim()) missing.push("METRILLM_SUPABASE_ANON_KEY");
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
    runtime_backend: result.metadata.runtimeBackend ?? "ollama",
    model_format: result.metadata.modelFormat ?? "gguf",
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
    const { data, error } = await supabase.rpc("get_rank", {
      p_global_score: globalScore,
      p_cpu: cpu,
    });

    if (error || !data) {
      return { rankGlobalPct: null, rankCpuPct: null, totalCount: 0 };
    }

    const { total_count, better_count, cpu_total, cpu_better } = data;
    const rankGlobalPct =
      total_count > 0 ? Math.max(1, Math.round((better_count + 1) / total_count * 100)) : null;
    const rankCpuPct =
      cpu_total > 0 ? Math.max(1, Math.round((cpu_better + 1) / cpu_total * 100)) : null;

    return { rankGlobalPct, rankCpuPct, totalCount: total_count };
  } catch {
    return { rankGlobalPct: null, rankCpuPct: null, totalCount: 0 };
  }
}
