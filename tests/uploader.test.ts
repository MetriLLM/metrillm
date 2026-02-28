import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchResult } from "../src/types.js";

const {
  createClientMock,
  fromMock,
  insertMock,
  selectMock,
  singleMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  insertMock: vi.fn(),
  selectMock: vi.fn(),
  singleMock: vi.fn(),
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
    delete process.env.LLMETER_SUPABASE_URL;
    delete process.env.LLMETER_SUPABASE_ANON_KEY;
    delete process.env.LLMETER_PUBLIC_RESULT_BASE_URL;

    selectMock.mockReturnValue({ single: singleMock });
    insertMock.mockReturnValue({ select: selectMock });
    fromMock.mockReturnValue({ insert: insertMock });
    createClientMock.mockReturnValue({ from: fromMock });
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

  it("computes percentile ranks when score and counts are available", async () => {
    let selectCall = 0;
    fromMock.mockImplementation(() => ({
      insert: insertMock,
      select: () => {
        selectCall++;
        if (selectCall === 1) {
          return Promise.resolve({ count: 100 });
        }
        if (selectCall === 2) {
          return { gt: async () => ({ count: 19 }) };
        }
        if (selectCall === 3) {
          return { eq: async () => ({ count: 20 }) };
        }
        if (selectCall === 4) {
          return { eq: () => ({ gt: async () => ({ count: 3 }) }) };
        }
        return Promise.resolve({ count: 0 });
      },
    }));
    singleMock.mockResolvedValueOnce({ data: { id: "row-rank" }, error: null });
    const { uploadBenchResult } = await import("../src/core/uploader.js");

    const out = await uploadBenchResult({
      ...sampleResult(),
      fitness: {
        ...sampleResult().fitness,
        globalScore: 80,
      },
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
