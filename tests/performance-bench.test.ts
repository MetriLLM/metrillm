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

vi.mock("../src/core/ollama-client.js", () => ({
  abortOngoingRequests: vi.fn(),
  listRunningModels: vi.fn(async () => []),
  generateStream: vi.fn(async (_model: string, _prompt: string, streamOpts?: { onToken?: () => void }) => {
    const next = generatePlan.shift() ?? "ok";
    if (next === "fail") {
      throw new Error("mock stream failure");
    }
    streamOpts?.onToken?.();
    return {
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

describe("runPerformanceBench", () => {
  beforeEach(() => {
    generatePlan = [];
    memoryPlan = [
      { usedGB: 10, percent: 40 },
      { usedGB: 13, percent: 47 },
    ];
  });

  it("continues when some prompts fail (non-strict mode)", async () => {
    // warmup + 5 prompts
    generatePlan = ["ok", "ok", "fail", "ok", "ok", "ok"];

    const perf = await runPerformanceBench("test-model", {
      failOnPromptError: false,
      minSuccessfulPrompts: 3,
    });

    expect(perf.tokensPerSecond).toBeGreaterThan(0);
    expect(perf.promptTokens).toBe(4 * 50);
    expect(perf.completionTokens).toBe(4 * 100);
    expect(perf.memoryHostPercent).toBe(47);
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
});
