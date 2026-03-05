/**
 * Test intent:
 * - Verify performance benchmark resilience and strictness behavior.
 * - Ensure partial prompt failures are handled according to options.
 *
 * Why it matters:
 * - Performance metrics drive hardware-fit verdicts.
 * - Timeout/error handling bugs can invalidate benchmark outcomes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type PlanItem = "ok" | "fail";

let generatePlan: PlanItem[] = [];
let memoryPlan: Array<{ usedGB: number; percent: number; totalGB: number }> = [];
let runtimeName = "ollama";

let thinkingPlan: Array<string | undefined> = [];

vi.mock("../src/core/ollama-client.js", () => ({
  abortOngoingRequests: vi.fn(),
  listRunningModels: vi.fn(async () => []),
  listModels: vi.fn(async () => []),
  getOllamaVersion: vi.fn(async () => "0.0.0-test"),
  generateStream: vi.fn(async (_model: string, _prompt: string, streamOpts?: { onFirstChunk?: () => void; onToken?: () => void }) => {
    const next = generatePlan.shift() ?? "ok";
    if (next === "fail") {
      throw new Error("mock stream failure");
    }
    streamOpts?.onFirstChunk?.();
    streamOpts?.onToken?.();
    const thinking = thinkingPlan.shift();
    return {
      response: "test response",
      ...(thinking ? { thinking } : {}),
      loadDuration: 2_000_000_000, // ns
      evalDuration: 1_000_000_000, // ns
      evalCount: 100,
      promptEvalCount: 50,
    };
  }),
}));

vi.mock("../src/core/hardware.js", () => ({
  getMemoryUsage: vi.fn(async () => {
    const next = memoryPlan.shift();
    if (!next) return { usedGB: 10, percent: 40, totalGB: 32 };
    return next;
  }),
  detectThermalPressure: vi.fn(async () => "nominal"),
  detectBatteryPowered: vi.fn(async () => undefined),
  getSwapUsedGB: vi.fn(async () => 0),
  getCpuLoad: vi.fn(async () => 45.0),
}));

vi.mock("../src/core/lm-studio-client.js", () => ({
  listModels: vi.fn(async () => []),
  listRunningModels: vi.fn(async () => []),
  getLMStudioVersion: vi.fn(async () => "unknown"),
  generate: vi.fn(),
  generateStream: vi.fn(),
  setDefaultKeepAlive: vi.fn(),
  unloadModel: vi.fn(),
  abortOngoingRequests: vi.fn(),
}));

vi.mock("../src/ui/progress.js", () => ({
  createSpinner: () => ({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    isSpinning: false,
    text: "",
  }),
  subStep: vi.fn(),
}));

import { runPerformanceBench } from "../src/benchmarks/performance.js";
import * as ollamaClient from "../src/core/ollama-client.js";
import * as runtime from "../src/core/runtime.js";
import * as hardware from "../src/core/hardware.js";

describe("runPerformanceBench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generatePlan = [];
    thinkingPlan = [];
    runtimeName = "ollama";
    memoryPlan = [
      { usedGB: 10, percent: 40, totalGB: 32 },
      { usedGB: 13, percent: 47, totalGB: 32 },
    ];
    runtime.setRuntimeByName(runtimeName);
  });

  it("continues when some prompts fail (non-strict mode)", async () => {
    // warmup + 5 prompts
    generatePlan = ["ok", "ok", "fail", "ok", "ok", "ok"];

    const result = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(result.metrics.tokensPerSecond).toBeGreaterThan(0);
    expect(result.metrics.promptTokens).toBe(4 * 50);
    expect(result.metrics.completionTokens).toBe(4 * 100);
    expect(result.metrics.firstChunkMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.memoryHostPercent).toBe(47);
    expect(result.thinkingDetected).toBe(false);
  });

  it("fails when successful prompts are below minimum threshold", async () => {
    generatePlan = ["ok", "fail", "fail", "fail", "ok", "fail"];

    await expect(
      runPerformanceBench("test-model", {
        failOnPromptError: false,
        minSuccessfulPrompts: 3,
      })
    ).rejects.toThrow(/too few successful prompts/i);
  });

  it("fails fast in strict mode on first prompt error", async () => {
    generatePlan = ["ok", "fail", "ok", "ok", "ok", "ok"];

    await expect(
      runPerformanceBench("test-model", {
        failOnPromptError: true,
      })
    ).rejects.toThrow(/mock stream failure/i);
  });

  it("detects thinking content when model returns thinking field", async () => {
    // warmup + 5 prompts — thinking on prompts 1 and 3
    generatePlan = ["ok", "ok", "ok", "ok", "ok", "ok"];
    thinkingPlan = [
      undefined, // warmup
      "Let me think about recursion step by step", // prompt 1
      undefined, // prompt 2
      "I need to compare TCP and UDP carefully", // prompt 3
      undefined, // prompt 4
      undefined, // prompt 5
    ];

    const result = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(result.thinkingDetected).toBe(true);
    expect(result.metrics.thinkingTokensEstimate).toBeGreaterThan(0);
  });

  it("does not flag thinking when no thinking content present", async () => {
    generatePlan = ["ok", "ok", "ok", "ok", "ok", "ok"];
    thinkingPlan = [];

    const result = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(result.thinkingDetected).toBe(false);
    expect(result.metrics.thinkingTokensEstimate).toBeUndefined();
  });

  it("forwards stream stall timeout to runtime generate calls", async () => {
    generatePlan = ["ok", "ok", "ok", "ok", "ok", "ok"];
    thinkingPlan = [];

    await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
      streamStallTimeoutMs: 180_000,
    });

    const generateStreamMock = vi.mocked(ollamaClient.generateStream);
    expect(generateStreamMock).toHaveBeenCalled();
    expect(
      generateStreamMock.mock.calls.every((call) => {
        const options = call[3];
        return options?.stall_timeout_ms === 180_000;
      })
    ).toBe(true);
  });

  it("falls back to host memory delta when running model size is unavailable", async () => {
    generatePlan = ["ok", "ok", "ok", "ok", "ok", "ok"];
    memoryPlan = [
      { usedGB: 10, percent: 40, totalGB: 10 },
      { usedGB: 10, percent: 40, totalGB: 10 },
    ];

    const result = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(result.metrics.memoryUsedGB).toBe(0);
    expect(result.metrics.memoryPercent).toBe(0);
    expect(result.metrics.memoryFootprintAvailable).toBe(true);
    expect(vi.mocked(ollamaClient.listModels)).not.toHaveBeenCalled();
  });

  it("marks memory footprint unavailable when model was already loaded and runtime size is unknown", async () => {
    generatePlan = ["ok", "ok", "ok", "ok", "ok", "ok"];
    memoryPlan = [
      { usedGB: 10, percent: 40, totalGB: 10 },
      { usedGB: 10, percent: 40, totalGB: 10 },
    ];

    vi.mocked(ollamaClient.listRunningModels).mockResolvedValue([
      { name: "test-model", size: 0, vramUsed: 0 },
    ]);

    const result = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(result.metrics.memoryUsedGB).toBe(0);
    expect(result.metrics.memoryPercent).toBe(0);
    expect(result.metrics.memoryFootprintAvailable).toBe(false);
  });

  it("marks load time unavailable for LM Studio when runtime does not report it", async () => {
    runtime.setRuntimeByName("lm-studio");
    const lmStudioGenerateStreamMock = vi.mocked(
      (await import("../src/core/lm-studio-client.js")).generateStream
    );
    lmStudioGenerateStreamMock.mockImplementation(async (_model: string, _prompt: string, streamOpts?: { onFirstChunk?: () => void; onToken?: () => void }) => {
      streamOpts?.onFirstChunk?.();
      streamOpts?.onToken?.();
      return {
        response: "test response",
        loadDuration: 0,
        evalDuration: 1_000_000_000,
        evalCount: 100,
        promptEvalCount: 50,
      };
    });

    const result = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(result.metrics.loadTime).toBe(0);
    expect(result.metrics.loadTimeAvailable).toBe(false);
    expect(result.metrics.firstChunkMs).toBeGreaterThanOrEqual(0);
  });

  it("continues when optional environment probes fail", async () => {
    generatePlan = ["ok", "ok", "ok", "ok", "ok", "ok"];
    const detectThermalPressureMock = vi.mocked(hardware.detectThermalPressure);
    const getSwapUsedGBMock = vi.mocked(hardware.getSwapUsedGB);
    const detectBatteryPoweredMock = vi.mocked(hardware.detectBatteryPowered);

    detectThermalPressureMock.mockRejectedValueOnce(new Error("thermal probe unavailable"));
    getSwapUsedGBMock.mockRejectedValueOnce(new Error("swap probe unavailable"));
    detectBatteryPoweredMock.mockRejectedValueOnce(new Error("battery probe unavailable"));
    detectThermalPressureMock.mockRejectedValueOnce(new Error("thermal probe unavailable"));
    getSwapUsedGBMock.mockRejectedValueOnce(new Error("swap probe unavailable"));

    const result = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(result.metrics.tokensPerSecond).toBeGreaterThan(0);
    expect(result.benchEnvironment).toMatchObject({
      thermalPressureBefore: "unknown",
      thermalPressureAfter: "unknown",
    });
    expect(result.benchEnvironment?.batteryPowered).toBeUndefined();
    expect(result.benchEnvironment?.swapDeltaGB).toBeUndefined();
  });

  it("reports cpuAvgLoad and cpuPeakLoad in benchEnvironment", async () => {
    generatePlan = ["ok", "ok", "ok", "ok", "ok", "ok"];

    const result = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(result.benchEnvironment?.cpuAvgLoad).toBe(45.0);
    expect(result.benchEnvironment?.cpuPeakLoad).toBe(45.0);
  });

  it("omits cpuAvgLoad when all CPU probes fail", async () => {
    generatePlan = ["ok", "ok", "ok", "ok", "ok", "ok"];
    const getCpuLoadMock = vi.mocked(hardware.getCpuLoad);
    getCpuLoadMock.mockResolvedValue(-1);

    const result = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(result.benchEnvironment?.cpuAvgLoad).toBeUndefined();
    expect(result.benchEnvironment?.cpuPeakLoad).toBeUndefined();
  });

  it("does not report swap delta when pre-bench swap probe fails but post-bench probe succeeds", async () => {
    generatePlan = ["ok", "ok", "ok", "ok", "ok", "ok"];
    const getSwapUsedGBMock = vi.mocked(hardware.getSwapUsedGB);

    getSwapUsedGBMock.mockRejectedValueOnce(new Error("swap probe unavailable"));
    getSwapUsedGBMock.mockResolvedValueOnce(2.3);

    const result = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(result.metrics.tokensPerSecond).toBeGreaterThan(0);
    expect(result.benchEnvironment?.swapDeltaGB).toBeUndefined();
  });
});
