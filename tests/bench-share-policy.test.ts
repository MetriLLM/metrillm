/**
 * Test intent:
 * - Enforce sharing policy: uploads are allowed only for full benchmarks.
 *
 * Why it matters:
 * - Perf-only runs skip quality scoring and must not be published.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listModelsMock,
  getRuntimeVersionMock,
  setRuntimeKeepAliveMock,
  setRuntimeByNameMock,
  unloadModelMock,
  getHardwareInfoMock,
  runPerformanceBenchMock,
  runReasoningBenchMock,
  runMathBenchMock,
  runCodingBenchMock,
  runInstructionFollowingBenchMock,
  runStructuredOutputBenchMock,
  runMultilingualBenchMock,
  computeFitnessMock,
  saveResultMock,
  uploadBenchResultMock,
  promptShareMock,
  openUrlMock,
  warnMsgMock,
} = vi.hoisted(() => ({
  listModelsMock: vi.fn(),
  getRuntimeVersionMock: vi.fn(),
  setRuntimeKeepAliveMock: vi.fn(),
  setRuntimeByNameMock: vi.fn(),
  unloadModelMock: vi.fn(),
  getHardwareInfoMock: vi.fn(),
  runPerformanceBenchMock: vi.fn(),
  runReasoningBenchMock: vi.fn(),
  runMathBenchMock: vi.fn(),
  runCodingBenchMock: vi.fn(),
  runInstructionFollowingBenchMock: vi.fn(),
  runStructuredOutputBenchMock: vi.fn(),
  runMultilingualBenchMock: vi.fn(),
  computeFitnessMock: vi.fn(),
  saveResultMock: vi.fn(),
  uploadBenchResultMock: vi.fn(),
  promptShareMock: vi.fn(),
  openUrlMock: vi.fn(),
  warnMsgMock: vi.fn(),
}));

vi.mock("../src/core/runtime.js", () => ({
  listModels: listModelsMock,
  getRuntimeVersion: getRuntimeVersionMock,
  setRuntimeByName: setRuntimeByNameMock,
  getRuntimeName: () => "ollama",
  getRuntimeDisplayName: () => "Ollama",
  getRuntimeModelInstallHint: () => "Pull one with: ollama pull <model>",
  getRuntimeSetupHints: () => [
    "Start it with:  ollama serve",
    "Install it at:  https://ollama.com",
  ],
  getRuntimeModelFormat: () => "gguf",
  setRuntimeKeepAlive: setRuntimeKeepAliveMock,
  unloadModel: unloadModelMock,
}));

vi.mock("../src/core/hardware.js", () => ({
  getHardwareInfo: getHardwareInfoMock,
}));

vi.mock("../src/benchmarks/performance.js", () => ({
  runPerformanceBench: runPerformanceBenchMock,
}));

vi.mock("../src/benchmarks/reasoning.js", () => ({
  runReasoningBench: runReasoningBenchMock,
}));

vi.mock("../src/benchmarks/math.js", () => ({
  runMathBench: runMathBenchMock,
}));

vi.mock("../src/benchmarks/coding.js", () => ({
  runCodingBench: runCodingBenchMock,
}));

vi.mock("../src/benchmarks/instruction-following.js", () => ({
  runInstructionFollowingBench: runInstructionFollowingBenchMock,
}));

vi.mock("../src/benchmarks/structured-output.js", () => ({
  runStructuredOutputBench: runStructuredOutputBenchMock,
}));

vi.mock("../src/benchmarks/multilingual.js", () => ({
  runMultilingualBench: runMultilingualBenchMock,
}));

vi.mock("../src/scoring/fitness.js", () => ({
  computeFitness: computeFitnessMock,
}));

vi.mock("../src/ui/results-table.js", () => ({
  printHardwareTable: vi.fn(),
  printPerformanceTable: vi.fn(),
  printQualityTable: vi.fn(),
  printSummaryTable: vi.fn(),
}));

vi.mock("../src/ui/verdict.js", () => ({
  printVerdict: vi.fn(),
}));

vi.mock("../src/ui/progress.js", () => ({
  stepHeader: vi.fn(),
  errorMsg: vi.fn(),
  warnMsg: warnMsgMock,
  infoMsg: vi.fn(),
  createSpinner: () => ({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    isSpinning: false,
    text: "",
  }),
  successMsg: vi.fn(),
}));

vi.mock("../src/core/store.js", () => ({
  saveResult: saveResultMock,
}));

vi.mock("../src/core/uploader.js", () => ({
  uploadBenchResult: uploadBenchResultMock,
}));

vi.mock("../src/ui/share-prompt.js", () => ({
  promptShare: promptShareMock,
}));

vi.mock("../src/ui/thinking-prompt.js", () => ({
  promptThinkingMode: vi.fn(async () => false),
}));

vi.mock("../src/utils.js", () => ({
  openUrl: openUrlMock,
}));

vi.mock("../src/core/telemetry.js", () => ({
  showTelemetryNotice: vi.fn(async () => {}),
  trackBenchStarted: vi.fn(async () => {}),
  trackBenchCompleted: vi.fn(async () => {}),
  trackBenchShared: vi.fn(async () => {}),
  flushTelemetry: vi.fn(async () => {}),
}));

import { benchCommand } from "../src/commands/bench.js";

describe("bench share policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRuntimeByNameMock.mockReturnValue("ollama");
    listModelsMock.mockResolvedValue([{ name: "test-model", size: 123, modelFormat: "gguf" }]);
    getRuntimeVersionMock.mockResolvedValue("0.5.12");
    getHardwareInfoMock.mockResolvedValue({
      cpu: "CPU",
      cpuCores: 8,
      cpuPCores: null,
      cpuECores: null,
      cpuFreqGHz: null,
      totalMemoryGB: 32,
      freeMemoryGB: 12,
      memoryType: null,
      swapTotalGB: 0,
      swapUsedGB: 0,
      gpu: "GPU",
      gpuCores: null,
      gpuVramMB: null,
      os: "OS",
      arch: "arm64",
    });
    runPerformanceBenchMock.mockResolvedValue({
      metrics: {
        tokensPerSecond: 40,
        ttft: 900,
        loadTime: 1500,
        totalTokens: 500,
        promptTokens: 100,
        completionTokens: 400,
        memoryUsedGB: 10,
        memoryPercent: 31,
        memoryHostPercent: 60,
      },
      thinkingDetected: false,
    });
    const category = { score: 80, correct: 8, total: 10, details: [] };
    runReasoningBenchMock.mockResolvedValue(category);
    runMathBenchMock.mockResolvedValue(category);
    runCodingBenchMock.mockResolvedValue(category);
    runInstructionFollowingBenchMock.mockResolvedValue(category);
    runStructuredOutputBenchMock.mockResolvedValue(category);
    runMultilingualBenchMock.mockResolvedValue(category);
    computeFitnessMock.mockImplementation((_perf: unknown, quality: unknown) => ({
      verdict: "GOOD",
      globalScore: quality ? 75 : null,
      hardwareFitScore: 70,
      performanceScore: { total: 70, speed: 28, ttft: 22, memory: 20 },
      qualityScore: quality
        ? {
            total: 78,
            reasoning: 16,
            coding: 16,
            instructionFollowing: 16,
            structuredOutput: 12,
            math: 10,
            multilingual: 8,
          }
        : null,
      categoryLabels: quality ? [] : null,
      disqualifiers: [],
      warnings: [],
      interpretation: "ok",
      tuning: {
        profile: "BALANCED",
        speed: { excellent: 30, good: 16, marginal: 7, hardMin: 5 },
        ttft: { excellentMs: 1000, goodMs: 2200, marginalMs: 5000, hardMaxMs: 15000 },
        loadTimeHardMaxMs: 180000,
      },
    }));
    saveResultMock.mockResolvedValue("/tmp/result.json");
    uploadBenchResultMock.mockResolvedValue({
      id: "id-1",
      url: "https://example.test/result/id-1",
      rankGlobalPct: null,
      rankCpuPct: null,
      totalCount: 0,
    });
    promptShareMock.mockResolvedValue("share");
  });

  it("never uploads when perf-only is enabled", async () => {
    await benchCommand({
      model: "test-model",
      perfOnly: true,
      share: true,
      setExitCode: false,
      ciNoMenu: false,
    });

    expect(promptShareMock).not.toHaveBeenCalled();
    expect(uploadBenchResultMock).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(setRuntimeByNameMock).not.toHaveBeenCalled();
    expect(warnMsgMock).toHaveBeenCalledWith(
      "Sharing is not available in performance-only mode. Run a full benchmark to upload results."
    );
  });

  it("allows upload on full benchmark", async () => {
    await benchCommand({
      model: "test-model",
      perfOnly: false,
      share: true,
      setExitCode: false,
      ciNoMenu: false,
    });

    expect(setRuntimeByNameMock).not.toHaveBeenCalled();
    expect(uploadBenchResultMock).toHaveBeenCalledTimes(1);
    const savedResult = saveResultMock.mock.calls[0]?.[0];
    expect(savedResult?.modelInfo?.thinkingDetected).toBe(false);
    expect(savedResult?.metadata?.benchmarkProfile).toMatchObject({
      version: "v1",
      sampling: { temperature: 0, topP: 1, seed: 42 },
      thinkingMode: "disabled",
      contextWindowTokens: null,
      contextPolicy: "runtime-default",
    });
  });

  it("forwards timeout overrides to performance and quality benchmarks", async () => {
    await benchCommand({
      model: "test-model",
      perfOnly: false,
      share: false,
      setExitCode: false,
      ciNoMenu: true,
      perfWarmupTimeoutMs: 500_000,
      perfPromptTimeoutMs: 180_000,
      qualityTimeoutMs: 240_000,
      codingTimeoutMs: 360_000,
      lmStudioStreamStallTimeoutMs: 210_000,
    });

    expect(runPerformanceBenchMock).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({
        warmupTimeoutMs: 500_000,
        promptTimeoutMs: 180_000,
        think: false,
        streamStallTimeoutMs: 210_000,
      })
    );
    expect(runReasoningBenchMock).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({ timeoutMs: 240_000, think: false })
    );
    expect(runMathBenchMock).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({ timeoutMs: 240_000, think: false })
    );
    expect(runCodingBenchMock).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({ timeoutMs: 360_000, think: false })
    );
    expect(runInstructionFollowingBenchMock).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({ timeoutMs: 240_000, think: false })
    );
    expect(runStructuredOutputBenchMock).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({ timeoutMs: 240_000, think: false })
    );
    expect(runMultilingualBenchMock).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({ timeoutMs: 240_000, think: false })
    );
  });

  it("persists thinking mode as true when explicitly enabled", async () => {
    await benchCommand({
      model: "test-model",
      perfOnly: false,
      share: false,
      setExitCode: false,
      ciNoMenu: true,
      thinking: true,
    });

    expect(runPerformanceBenchMock).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({ think: true })
    );
    expect(runReasoningBenchMock).toHaveBeenCalledWith(
      "test-model",
      expect.objectContaining({ think: true })
    );
    const savedResult = saveResultMock.mock.calls[0]?.[0];
    expect(savedResult?.modelInfo?.thinkingDetected).toBe(true);
  });

  it("uses per-model modelFormat metadata when available", async () => {
    listModelsMock.mockResolvedValueOnce([{ name: "test-model", size: 123, modelFormat: "mlx" }]);

    await benchCommand({
      model: "test-model",
      perfOnly: false,
      share: false,
      setExitCode: false,
      ciNoMenu: true,
    });

    expect(saveResultMock).toHaveBeenCalledTimes(1);
    const savedResult = saveResultMock.mock.calls[0]?.[0];
    expect(savedResult?.metadata?.modelFormat).toBe("mlx");
  });
});
