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
let memoryPlan: Array<{ usedGB: number; percent: number }> = [];

let thinkingPlan: Array<string | undefined> = [];

vi.mock("../src/core/ollama-client.js", () => ({
  abortOngoingRequests: vi.fn(),
  listRunningModels: vi.fn(async () => []),
  generateStream: vi.fn(async (_model: string, _prompt: string, streamOpts?: { onToken?: () => void }) => {
    const next = generatePlan.shift() ?? "ok";
    if (next === "fail") {
      throw new Error("mock stream failure");
    }
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
    if (!next) return { usedGB: 10, percent: 40 };
    return next;
  }),
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

describe("runPerformanceBench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generatePlan = [];
    thinkingPlan = [];
    memoryPlan = [
      { usedGB: 10, percent: 40 },
      { usedGB: 13, percent: 47 },
    ];
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
});
