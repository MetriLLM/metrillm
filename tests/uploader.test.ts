import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchResult } from "../src/types.js";

const {
  createClientMock,
  fromMock,
  insertMock,
  selectMock,
  singleMock,
  upsertMock,
  rpcMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  insertMock: vi.fn(),
  selectMock: vi.fn(),
  singleMock: vi.fn(),
  upsertMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

function sampleResult(): BenchResult {
  return {
    model: "qwen2.5:7b",
    modelInfo: {
      parameterSize: "7B",
      quantization: "Q4_K_M",
      family: "qwen",
    },
    hardware: {
      cpu: "CPU",
      cpuCores: 8,
      cpuPCores: null,
      cpuECores: null,
      cpuFreqGHz: null,
      totalMemoryGB: 32,
      freeMemoryGB: 18,
      memoryType: null,
      swapTotalGB: 4,
      swapUsedGB: 0,
      gpu: "GPU",
      gpuCores: null,
      gpuVramMB: null,
      os: "TestOS",
      arch: "arm64",
    },
    performance: {
      tokensPerSecond: 42.5,
      ttft: 950,
      loadTime: 1800,
      totalTokens: 600,
      promptTokens: 200,
      completionTokens: 400,
      memoryUsedGB: 10.2,
      memoryPercent: 31.9,
      memoryHostPercent: 72.4,
    },
    quality: null,
    fitness: {
      verdict: "GOOD",
      globalScore: null,
      hardwareFitScore: 70,
      performanceScore: { total: 70, speed: 30, ttft: 20, memory: 20 },
      qualityScore: null,
      categoryLabels: null,
      disqualifiers: [],
      warnings: [],
      interpretation: "ok",
      tuning: {
        profile: "BALANCED",
        speed: { excellent: 30, good: 16, marginal: 7, hardMin: 5 },
        ttft: { excellentMs: 1000, goodMs: 2200, marginalMs: 5000, hardMaxMs: 15000 },
        loadTimeHardMaxMs: 180000,
      },
    },
    timestamp: "2026-02-28T18:00:00.000Z",
    metadata: {
      benchmarkSpecVersion: "0.1.0",
      promptPackVersion: "0.1.0",
      runtimeVersion: "0.5.12",
      rawLogHash: "abc123",
    },
  };
}

describe("uploadBenchResult", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.LLMETER_SUPABASE_URL = "https://example.supabase.co";
    process.env.LLMETER_SUPABASE_ANON_KEY = "anon-key";
    process.env.LLMETER_PUBLIC_RESULT_BASE_URL = "https://metrillm.dev";

    selectMock.mockReturnValue({ single: singleMock });
    insertMock.mockReturnValue({ select: selectMock });
    upsertMock.mockResolvedValue({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "benchmark_leads") {
        return { upsert: upsertMock };
      }
      return { insert: insertMock };
    });
    rpcMock.mockResolvedValue({ data: null, error: { message: "not found" } });
    createClientMock.mockReturnValue({ from: fromMock, rpc: rpcMock });
  });

  it("uploads benchmark row and returns hosted URL", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "row-1" }, error: null });
    const { uploadBenchResult } = await import("../src/core/uploader.js");

    const out = await uploadBenchResult(sampleResult());

    expect(fromMock).toHaveBeenCalledWith("benchmarks");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.model).toBe("qwen2.5:7b");
    expect(inserted.parameter_size).toBe("7B");
    expect(inserted.memory_percent).toBe(72.4);
    expect(inserted.machine_model).toBeNull();
    expect(inserted.power_mode).toBeNull();
    expect(inserted.thinking_detected).toBeNull();
    expect(inserted.thinking_tokens_estimate).toBeNull();
    expect(out).toEqual({
      id: "row-1",
      url: "https://metrillm.dev/result/row-1",
      rankGlobalPct: null,
      rankCpuPct: null,
      totalCount: 0,
    });
  });

  it("uses configured public base URL and trims trailing slash", async () => {
    process.env.LLMETER_PUBLIC_RESULT_BASE_URL = "https://example.test/";
    singleMock.mockResolvedValueOnce({ data: { id: "row-2" }, error: null });
    const { uploadBenchResult } = await import("../src/core/uploader.js");

    const out = await uploadBenchResult(sampleResult());
    expect(out.url).toBe("https://example.test/result/row-2");
  });

  it("upserts submitter lead when profile is provided", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "row-lead" }, error: null });
    const { uploadBenchResult } = await import("../src/core/uploader.js");

    const out = await uploadBenchResult(
      {
        ...sampleResult(),
        submitter: {
          nickname: "cyril",
          emailHash: "hash-123",
        },
      },
      { submitterEmail: "hello@example.com" }
    );

    expect(out.id).toBe("row-lead");
    expect(fromMock).toHaveBeenCalledWith("benchmark_leads");
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "hello@example.com",
        email_hash: "hash-123",
        nickname: "cyril",
        source: "cli",
      }),
      { onConflict: "email_hash" }
    );
  });

  it("computes percentile ranks when score and counts are available", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { total_count: 100, better_count: 19, cpu_total: 20, cpu_better: 3 },
      error: null,
    });
    singleMock.mockResolvedValueOnce({ data: { id: "row-rank" }, error: null });
    const { uploadBenchResult } = await import("../src/core/uploader.js");

    const out = await uploadBenchResult({
      ...sampleResult(),
      fitness: {
        ...sampleResult().fitness,
        globalScore: 80,
      },
    });

    expect(rpcMock).toHaveBeenCalledWith("get_rank", {
      p_global_score: 80,
      p_cpu: "CPU",
    });
    expect(out).toEqual({
      id: "row-rank",
      url: "https://metrillm.dev/result/row-rank",
      rankGlobalPct: 20,
      rankCpuPct: 20,
      totalCount: 100,
    });
  });

  it("surfaces duplicate upload as friendly message", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const { uploadBenchResult } = await import("../src/core/uploader.js");

    await expect(uploadBenchResult(sampleResult())).rejects.toThrow(
      "This benchmark result has already been uploaded."
    );
  });

  it("includes runtime_backend and model_format in uploaded row", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "row-rt" }, error: null });
    const { uploadBenchResult } = await import("../src/core/uploader.js");

    const result = sampleResult();
    result.metadata.runtimeBackend = "ollama";
    result.metadata.modelFormat = "gguf";
    await uploadBenchResult(result);

    const inserted = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.runtime_backend).toBe("ollama");
    expect(inserted.model_format).toBe("gguf");
  });

  it("defaults runtime_backend and model_format when metadata fields are absent", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "row-def" }, error: null });
    const { uploadBenchResult } = await import("../src/core/uploader.js");

    const result = sampleResult();
    delete result.metadata.runtimeBackend;
    delete result.metadata.modelFormat;
    await uploadBenchResult(result);

    const inserted = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.runtime_backend).toBe("ollama");
    expect(inserted.model_format).toBe("gguf");
  });

  it("surfaces generic upload errors", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "other", message: "network down" },
    });
    const { uploadBenchResult } = await import("../src/core/uploader.js");

    await expect(uploadBenchResult(sampleResult())).rejects.toThrow(
      "Upload failed: network down"
    );
  });
});
