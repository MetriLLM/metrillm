/**
 * Test intent:
 * - Verify that performance, quality, and final fitness scoring are consistent.
 * - Ensure scoring monotonicity (better inputs should not produce worse scores).
 *
 * Why it matters:
 * - The final recommendation shown to users depends directly on these formulas.
 * - A small scoring bug can rank models incorrectly and break trust in the tool.
 */
import { describe, it, expect } from "vitest";
import {
  computePerformanceScore,
  deriveHardwareFitTuning,
} from "../src/scoring/performance-scorer.js";
import { computeQualityScore, effectiveScore, RESPONSE_TIME_LIMITS_MS } from "../src/scoring/quality-scorer.js";
import { computeFitness } from "../src/scoring/fitness.js";
import type {
  PerformanceMetrics,
  QualityMetrics,
  CategoryResult,
  QuestionResult,
  HardwareInfo,
} from "../src/types.js";

function makePerf(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    tokensPerSecond: 40,
    ttft: 800,
    loadTime: 2000,
    totalTokens: 500,
    promptTokens: 100,
    completionTokens: 400,
    memoryUsedGB: 16,
    memoryPercent: 25,
    ...overrides,
  };
}

function makeCategory(score: number, correct: number, total: number): CategoryResult {
  return { score, correct, total, details: [] };
}

function makeQuality(
  reasoning = 80,
  math = 70,
  coding = 60,
  instructionFollowing = 70,
  structuredOutput = 65,
  multilingual = 60
): QualityMetrics {
  return {
    reasoning: makeCategory(reasoning, Math.round(reasoning / 4), 25),
    math: makeCategory(math, Math.round(math / 4), 25),
    coding: makeCategory(coding, Math.round(coding * 15 / 100), 15),
    instructionFollowing: makeCategory(instructionFollowing, Math.round(instructionFollowing * 20 / 100), 20),
    structuredOutput: makeCategory(structuredOutput, Math.round(structuredOutput * 15 / 100), 15),
    multilingual: makeCategory(multilingual, Math.round(multilingual * 20 / 100), 20),
  };
}

function makeHardware(overrides: Partial<HardwareInfo> = {}): HardwareInfo {
  return {
    cpu: "Test CPU",
    cpuCores: 10,
    cpuPCores: 8,
    cpuECores: 2,
    cpuFreqGHz: 3.2,
    totalMemoryGB: 32,
    freeMemoryGB: 16,
    memoryType: "DDR5",
    swapTotalGB: 4,
    swapUsedGB: 0,
    gpu: "Test GPU",
    gpuCores: 16,
    gpuVramMB: null,
    os: "TestOS",
    arch: "arm64",
    powerMode: "balanced",
    cpuCurrentSpeedGHz: 3.0,
    ...overrides,
  };
}

describe("computePerformanceScore", () => {
  it("gives max score for fast model", () => {
    const score = computePerformanceScore(makePerf({
      tokensPerSecond: 80,
      ttft: 300,
      memoryPercent: 20,
    }));
    expect(score.speed).toBe(50);
    expect(score.ttft).toBe(20);
    expect(score.memory).toBe(30);
    expect(score.total).toBe(100);
  });

  it("gives low score for slow model", () => {
    const score = computePerformanceScore(makePerf({
      tokensPerSecond: 3,
      ttft: 8000,
      memoryPercent: 85,
    }));
    expect(score.speed).toBeLessThanOrEqual(5);
    expect(score.ttft).toBeLessThanOrEqual(15);
    expect(score.memory).toBeLessThanOrEqual(15);
    expect(score.total).toBeLessThan(35);
  });

  it("handles mid-range values", () => {
    const score = computePerformanceScore(makePerf({
      tokensPerSecond: 25,
      ttft: 1500,
      memoryPercent: 60,
    }));
    // Without explicit hardware, uses default mid-range tuning
    expect(score.speed).toBeGreaterThanOrEqual(30);
    expect(score.speed).toBeLessThanOrEqual(50);
    expect(score.ttft).toBeGreaterThanOrEqual(13);
    expect(score.ttft).toBeLessThanOrEqual(20);
    expect(score.memory).toBeGreaterThanOrEqual(15);
    expect(score.memory).toBeLessThanOrEqual(25);
  });

  it("total equals sum of components (clamped to 100)", () => {
    const score = computePerformanceScore(makePerf());
    expect(score.total).toBe(Math.min(100, score.speed + score.ttft + score.memory));
  });

  it("total never exceeds 100", () => {
    const score = computePerformanceScore(makePerf({
      tokensPerSecond: 100,
      ttft: 100,
      memoryPercent: 5,
    }));
    expect(score.total).toBeLessThanOrEqual(100);
  });

  it("TTFT score decreases as TTFT increases within a range", () => {
    const fast = computePerformanceScore(makePerf({ ttft: 600 }));
    const slow = computePerformanceScore(makePerf({ ttft: 900 }));
    expect(fast.ttft).toBeGreaterThanOrEqual(slow.ttft);
  });

  it("TTFT: 501ms scores higher than 999ms", () => {
    const fast = computePerformanceScore(makePerf({ ttft: 501 }));
    const slow = computePerformanceScore(makePerf({ ttft: 999 }));
    expect(fast.ttft).toBeGreaterThanOrEqual(slow.ttft);
  });

  it("memory score decreases as usage increases within a range", () => {
    const low = computePerformanceScore(makePerf({ memoryPercent: 35 }));
    const high = computePerformanceScore(makePerf({ memoryPercent: 45 }));
    expect(low.memory).toBeGreaterThanOrEqual(high.memory);
  });

  it("memory: 31% scores higher than 49%", () => {
    const low = computePerformanceScore(makePerf({ memoryPercent: 31 }));
    const high = computePerformanceScore(makePerf({ memoryPercent: 49 }));
    expect(low.memory).toBeGreaterThanOrEqual(high.memory);
  });

  it("adapts speed scoring to hardware profile", () => {
    const perf = makePerf({ tokensPerSecond: 22, ttft: 1200, memoryPercent: 30 });
    const entryScore = computePerformanceScore(
      perf,
      makeHardware({ cpuCores: 6, totalMemoryGB: 16 })
    );
    const highEndScore = computePerformanceScore(
      perf,
      makeHardware({ cpuCores: 16, totalMemoryGB: 64 })
    );
    expect(entryScore.speed).toBeGreaterThanOrEqual(highEndScore.speed);
  });

  it("classifies hardware profile tiers via continuous capacity", () => {
    expect(
      deriveHardwareFitTuning(makeHardware({ cpuCores: 6, totalMemoryGB: 16 })).profile
    ).toBe("ENTRY");
    expect(
      deriveHardwareFitTuning(makeHardware({ cpuCores: 10, totalMemoryGB: 32 })).profile
    ).toBe("BALANCED");
    expect(
      deriveHardwareFitTuning(makeHardware({ cpuCores: 20, totalMemoryGB: 64 })).profile
    ).toBe("HIGH-END");
  });

  it("produces higher speed thresholds for beefier hardware", () => {
    const small = deriveHardwareFitTuning(makeHardware({ cpuCores: 6, totalMemoryGB: 16 }));
    const big   = deriveHardwareFitTuning(makeHardware({ cpuCores: 24, totalMemoryGB: 128 }));
    expect(big.speed.excellent).toBeGreaterThan(small.speed.excellent);
    expect(big.speed.hardMin).toBeGreaterThan(small.speed.hardMin);
    expect(big.ttft.excellentMs).toBeLessThan(small.ttft.excellentMs);
  });

  it("sanitizes non-finite performance inputs", () => {
    const score = computePerformanceScore(
      makePerf({
        tokensPerSecond: Number.NaN,
        ttft: Number.NaN,
        memoryPercent: Number.NaN,
      })
    );
    expect(Number.isFinite(score.total)).toBe(true);
    expect(score.speed).toBe(0);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });
});

describe("computeQualityScore", () => {
  it("computes weighted quality score with 6 dimensions", () => {
    const score = computeQualityScore(makeQuality(100, 100, 100, 100, 100, 100));
    expect(score.reasoning).toBe(20);
    expect(score.coding).toBe(20);
    expect(score.instructionFollowing).toBe(20);
    expect(score.structuredOutput).toBe(15);
    expect(score.math).toBe(15);
    expect(score.multilingual).toBe(10);
    expect(score.total).toBe(100);
  });

  it("handles zero scores", () => {
    const score = computeQualityScore(makeQuality(0, 0, 0, 0, 0, 0));
    expect(score.total).toBe(0);
  });

  it("computes partial scores", () => {
    const score = computeQualityScore(makeQuality(50, 50, 50, 50, 50, 50));
    expect(score.reasoning).toBe(10);
    expect(score.coding).toBe(11);
    expect(score.instructionFollowing).toBe(10);
    expect(score.structuredOutput).toBe(8); // round(7.5)
    expect(score.math).toBe(8); // round(7.5)
    expect(score.multilingual).toBe(5);
    expect(score.total).toBe(52); // 10+11+10+8+8+5
  });

  it("total equals sum of components", () => {
    const score = computeQualityScore(makeQuality(80, 60, 40, 70, 55, 45));
    expect(score.total).toBe(
      score.reasoning + score.coding + score.instructionFollowing +
      score.structuredOutput + score.math + score.multilingual
    );
  });

  it("clamps out-of-range quality inputs", () => {
    const score = computeQualityScore(makeQuality(150, -10, 200, 50, Number.NaN, 30));
    expect(score.reasoning).toBe(20);
    expect(score.coding).toBe(20);
    expect(score.math).toBe(0);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });
});

describe("computeFitness", () => {
  it("returns EXCELLENT for high global score", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const quality = makeQuality(90, 85, 80, 85, 80, 75);
    const fitness = computeFitness(perf, quality);
    expect(fitness.verdict).toBe("EXCELLENT");
    expect(fitness.hardwareFitScore).toBeGreaterThanOrEqual(80);
    expect(fitness.globalScore).not.toBeNull();
    expect(fitness.globalScore!).toBeGreaterThanOrEqual(80);
    expect(fitness.disqualifiers).toHaveLength(0);
  });

  it("returns GOOD for moderate scores", () => {
    const perf = makePerf({ tokensPerSecond: 18, ttft: 2300, memoryPercent: 55 });
    const quality = makeQuality(60, 50, 40, 55, 45, 40);
    const fitness = computeFitness(perf, quality);
    expect(["GOOD", "MARGINAL"]).toContain(fitness.verdict);
  });

  it("returns NOT RECOMMENDED for very slow model", () => {
    const perf = makePerf({ tokensPerSecond: 3, ttft: 10000, memoryPercent: 40 });
    const quality = makeQuality(80, 70, 60, 70, 65, 55);
    const fitness = computeFitness(perf, quality);
    expect(fitness.verdict).toBe("NOT RECOMMENDED");
    expect(fitness.disqualifiers.length).toBeGreaterThan(0);
  });

  it("returns NOT RECOMMENDED for memory hog", () => {
    const perf = makePerf({ tokensPerSecond: 40, ttft: 800, memoryPercent: 97 });
    const quality = makeQuality(80, 70, 60, 70, 65, 55);
    const fitness = computeFitness(perf, quality);
    expect(fitness.verdict).toBe("NOT RECOMMENDED");
    expect(fitness.disqualifiers.some((d) => d.includes("Memory"))).toBe(true);
  });

  it("does not disqualify when host memory is high but model delta is small", () => {
    const perf = makePerf({
      tokensPerSecond: 40,
      ttft: 800,
      memoryPercent: 4,
      memoryHostPercent: 97,
    });
    const fitness = computeFitness(perf, null);
    expect(fitness.disqualifiers.some((d) => d.includes("Memory"))).toBe(false);
    expect(fitness.warnings.some((w) => w.includes("Host memory is already high"))).toBe(true);
  });

  it("works in perf-only mode (quality=null)", () => {
    const perf = makePerf({ tokensPerSecond: 50, ttft: 600, memoryPercent: 30 });
    const fitness = computeFitness(perf, null);
    expect(fitness.qualityScore).toBeNull();
    expect(fitness.globalScore).toBeNull();
    expect(fitness.categoryLabels).toBeNull();
    expect(fitness.hardwareFitScore).toBe(fitness.performanceScore.total);
    expect(["EXCELLENT", "GOOD"]).toContain(fitness.verdict);
  });

  it("globalScore combines HW and quality", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const quality = makeQuality(100, 100, 100, 100, 100, 100);
    const fitness = computeFitness(perf, quality);
    // HW = 100, Quality = 100 → Global = 0.3*100 + 0.7*100 = 100
    expect(fitness.globalScore).toBe(100);
  });

  it("globalScore reflects quality weight", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const strongQuality = makeQuality(100, 100, 100, 100, 100, 100);
    const weakQuality = makeQuality(0, 0, 0, 0, 0, 0);

    const fitStrong = computeFitness(perf, strongQuality);
    const fitWeak = computeFitness(perf, weakQuality);

    // Same HW but different quality → different global scores
    expect(fitStrong.globalScore!).toBeGreaterThan(fitWeak.globalScore!);
    // HW score should be same
    expect(fitStrong.hardwareFitScore).toBe(fitWeak.hardwareFitScore);
  });

  it("disqualifies on both speed and memory", () => {
    const perf = makePerf({ tokensPerSecond: 2, memoryPercent: 98 });
    const fitness = computeFitness(perf, null);
    expect(fitness.disqualifiers).toHaveLength(2);
    expect(fitness.verdict).toBe("NOT RECOMMENDED");
  });

  it("adds a disqualifier when TTFT is extremely high", () => {
    const perf = makePerf({ ttft: 30_000 });
    const fitness = computeFitness(perf, null);
    expect(fitness.disqualifiers.some((d) => d.includes("Time to first token"))).toBe(true);
    expect(fitness.verdict).toBe("NOT RECOMMENDED");
  });

  it("adds a disqualifier when load time is extremely high", () => {
    const perf = makePerf({ loadTime: 350_000 });
    const fitness = computeFitness(perf, null);
    expect(fitness.disqualifiers.some((d) => d.includes("Model load time"))).toBe(true);
    expect(fitness.verdict).toBe("NOT RECOMMENDED");
  });

  it("treats invalid perf metrics as unsafe for recommendation", () => {
    const perf = makePerf({
      tokensPerSecond: Number.NaN,
      ttft: Number.NaN,
      loadTime: Number.NaN,
      memoryPercent: Number.NaN,
      memoryHostPercent: Number.NaN,
    });
    const fitness = computeFitness(perf, null);
    expect(fitness.verdict).toBe("NOT RECOMMENDED");
    expect(fitness.disqualifiers.length).toBeGreaterThan(0);
  });

  it("can disqualify on high-end profile while passing on entry profile", () => {
    const perf = makePerf({ tokensPerSecond: 4.5, ttft: 5000, loadTime: 100000 });
    const quality = makeQuality(70, 70, 70, 70, 70, 70);

    const onEntry = computeFitness(
      perf,
      quality,
      makeHardware({ cpuCores: 6, totalMemoryGB: 16 })
    );
    const onHighEnd = computeFitness(
      perf,
      quality,
      makeHardware({ cpuCores: 16, totalMemoryGB: 64 })
    );

    expect(onEntry.disqualifiers.some((d) => d.includes("Token speed"))).toBe(false);
    expect(onHighEnd.disqualifiers.some((d) => d.includes("Token speed"))).toBe(true);
  });

  it("categoryLabels are computed from effective category scores", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const quality = makeQuality(90, 30, 80, 60, 10, 50);
    const fitness = computeFitness(perf, quality);

    expect(fitness.categoryLabels).not.toBeNull();
    expect(fitness.categoryLabels).toHaveLength(6);

    const reasoning = fitness.categoryLabels!.find((l) => l.category === "Reasoning");
    expect(reasoning!.level).toBe("Strong");
    expect(reasoning!.rawScore).toBe(92);

    const math = fitness.categoryLabels!.find((l) => l.category === "Math");
    expect(math!.level).toBe("Weak");

    const so = fitness.categoryLabels!.find((l) => l.category === "Structured Output");
    expect(so!.level).toBe("Poor");
  });

  it("adds low-quality warning in interpretation when quality < 15%", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const quality = makeQuality(10, 5, 0, 5, 3, 2);
    const fitness = computeFitness(perf, quality);
    expect(fitness.interpretation).toContain("Warning: model produced very low accuracy");
    expect(fitness.warnings.some((w) => w.includes("very low accuracy"))).toBe(true);
  });

  it("does not add low-quality warning when quality >= 15%", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const quality = makeQuality(40, 30, 20, 35, 25, 20);
    const fitness = computeFitness(perf, quality);
    expect(fitness.interpretation).not.toContain("Warning:");
    expect(fitness.warnings).toHaveLength(0);
  });

  it("does not add low-quality warning when quality is null", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const fitness = computeFitness(perf, null);
    expect(fitness.interpretation).not.toContain("Warning:");
    // No power mode warnings when balanced
    expect(fitness.warnings.some((w) => w.includes("low-power"))).toBe(false);
  });

  it("adds warning when system is in low-power mode", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const hw = makeHardware({ powerMode: "low-power" });
    const fitness = computeFitness(perf, null, hw);
    expect(fitness.warnings.some((w) => w.includes("low-power mode"))).toBe(true);
  });

  it("does not add low-power warning when power mode is balanced", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const hw = makeHardware({ powerMode: "balanced" });
    const fitness = computeFitness(perf, null, hw);
    expect(fitness.warnings.some((w) => w.includes("low-power"))).toBe(false);
  });

  it("adds CPU throttle warning when current speed < 80% of nominal", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const hw = makeHardware({ cpuFreqGHz: 3.0, cpuCurrentSpeedGHz: 2.0 });
    const fitness = computeFitness(perf, null, hw);
    expect(fitness.warnings.some((w) => w.includes("CPU appears throttled"))).toBe(true);
  });

  it("does not add CPU throttle warning when speed >= 80% of nominal", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const hw = makeHardware({ cpuFreqGHz: 3.0, cpuCurrentSpeedGHz: 2.8 });
    const fitness = computeFitness(perf, null, hw);
    expect(fitness.warnings.some((w) => w.includes("CPU appears throttled"))).toBe(false);
  });

  it("uses memoryHostPercent for memory score when available", () => {
    const perfWithHost = makePerf({
      memoryPercent: 10,
      memoryHostPercent: 75,
    });
    const perfWithoutHost = makePerf({
      memoryPercent: 10,
    });
    const fitnessWithHost = computeFitness(perfWithHost, null);
    const fitnessWithoutHost = computeFitness(perfWithoutHost, null);
    expect(fitnessWithHost.performanceScore.memory).toBeLessThan(
      fitnessWithoutHost.performanceScore.memory
    );
  });

  it("adds stability warning when tpsStdDev / mean > 0.3", () => {
    const perf = makePerf({
      tokensPerSecond: 20,
      tpsStdDev: 10,
    });
    const fitness = computeFitness(perf, null);
    expect(fitness.warnings.some((w) => w.includes("Token speed is unstable"))).toBe(true);
  });

  it("does not add stability warning when tpsStdDev / mean <= 0.3", () => {
    const perf = makePerf({
      tokensPerSecond: 40,
      tpsStdDev: 5,
    });
    const fitness = computeFitness(perf, null);
    expect(fitness.warnings.some((w) => w.includes("Token speed is unstable"))).toBe(false);
  });

  it("verdict is based on globalScore when quality is available", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    // HW = 100, Quality weak → global < 80 → might not be EXCELLENT
    const weakQuality = makeQuality(0, 0, 0, 0, 0, 0);
    const fitness = computeFitness(perf, weakQuality);
    // globalScore = 0.3*100 + 0.7*0 = 30 → NOT RECOMMENDED
    expect(fitness.verdict).toBe("NOT RECOMMENDED");
    expect(fitness.globalScore).toBe(30);
  });

  it("verdict uses hardwareFitScore when quality is null", () => {
    const perf = makePerf({ tokensPerSecond: 80, ttft: 300, memoryPercent: 20 });
    const fitness = computeFitness(perf, null);
    expect(fitness.verdict).toBe("EXCELLENT");
    expect(fitness.globalScore).toBeNull();
  });
});

// ── Time penalty tests ─────────────────────────────────────

function makeQuestion(id: number, correct: boolean, timeMs: number): QuestionResult {
  return {
    id,
    question: `q${id}`,
    expected: "A",
    actual: correct ? "A" : "B",
    correct,
    timeMs,
  };
}

function makeCategoryWithDetails(details: QuestionResult[]): CategoryResult {
  const correct = details.filter((d) => d.correct).length;
  const total = details.length;
  return {
    score: total > 0 ? (correct / total) * 100 : 0,
    correct,
    total,
    details,
  };
}

describe("effectiveScore", () => {
  it("counts only correct answers within time limit", () => {
    const result = makeCategoryWithDetails([
      makeQuestion(1, true, 5000),   // fast correct
      makeQuestion(2, true, 3000),   // fast correct
      makeQuestion(3, true, 35000),  // slow correct — penalized
      makeQuestion(4, false, 2000),  // fast incorrect
    ]);
    // 2 effective correct out of 4 total = 50%
    expect(effectiveScore(result, 30_000)).toBe(50);
  });

  it("returns 100 when all correct are within limit", () => {
    const result = makeCategoryWithDetails([
      makeQuestion(1, true, 1000),
      makeQuestion(2, true, 2000),
    ]);
    expect(effectiveScore(result, 30_000)).toBe(100);
  });

  it("returns 0 when all correct are over limit", () => {
    const result = makeCategoryWithDetails([
      makeQuestion(1, true, 40000),
      makeQuestion(2, true, 50000),
    ]);
    expect(effectiveScore(result, 30_000)).toBe(0);
  });

  it("incorrect answers are unaffected by time", () => {
    const result = makeCategoryWithDetails([
      makeQuestion(1, false, 1000),
      makeQuestion(2, false, 50000),
    ]);
    // Both incorrect, so 0% regardless of time
    expect(effectiveScore(result, 30_000)).toBe(0);
  });

  it("falls back to raw score when details are empty", () => {
    const result = makeCategory(75, 15, 20);
    expect(effectiveScore(result, 30_000)).toBe(75);
  });

  it("returns 0 when total is 0", () => {
    const result = makeCategoryWithDetails([]);
    result.total = 0;
    expect(effectiveScore(result, 30_000)).toBe(0);
  });
});

describe("computeQualityScore with time penalties", () => {
  it("penalizes slow correct answers and reports timePenalties", () => {
    const quality: QualityMetrics = {
      reasoning: makeCategoryWithDetails([
        makeQuestion(1, true, 5000),
        makeQuestion(2, true, 35000),  // slow
        makeQuestion(3, true, 40000),  // slow
        makeQuestion(4, false, 2000),
      ]),
      math: makeCategoryWithDetails([
        makeQuestion(1, true, 2000),
        makeQuestion(2, true, 3000),
      ]),
      coding: makeCategoryWithDetails([
        makeQuestion(1, true, 50000),  // under 90s limit
        makeQuestion(2, true, 95000),  // over 90s limit — slow
      ]),
      instructionFollowing: makeCategory(80, 16, 20),
      structuredOutput: makeCategory(60, 9, 15),
      multilingual: makeCategory(50, 10, 20),
    };

    const score = computeQualityScore(quality);

    // reasoning: 1/4 effective correct = 25%
    // math: 2/2 = 100%
    // coding: 1/2 = 50%
    // instructionFollowing: fallback to 80 (empty details)
    // structuredOutput: fallback to 60 (empty details)
    // multilingual: fallback to 50 (empty details)

    expect(score.timePenalties).toBeDefined();
    expect(score.timePenalties!.reasoning).toBe(2);
    expect(score.timePenalties!.coding).toBe(1);
    expect(score.timePenalties!.math).toBeUndefined();
  });

  it("does not include timePenalties when all answers are fast", () => {
    const quality: QualityMetrics = {
      reasoning: makeCategoryWithDetails([
        makeQuestion(1, true, 1000),
        makeQuestion(2, true, 2000),
      ]),
      math: makeCategoryWithDetails([
        makeQuestion(1, true, 1000),
      ]),
      coding: makeCategoryWithDetails([
        makeQuestion(1, true, 5000),
      ]),
      instructionFollowing: makeCategoryWithDetails([
        makeQuestion(1, true, 3000),
      ]),
      structuredOutput: makeCategoryWithDetails([
        makeQuestion(1, true, 2000),
      ]),
      multilingual: makeCategoryWithDetails([
        makeQuestion(1, true, 4000),
      ]),
    };

    const score = computeQualityScore(quality);
    expect(score.timePenalties).toBeUndefined();
  });

  it("QualityScore total reflects time penalties", () => {
    // All correct, all fast → max score
    const fastQuality: QualityMetrics = {
      reasoning: makeCategoryWithDetails([
        makeQuestion(1, true, 1000),
        makeQuestion(2, true, 1000),
      ]),
      math: makeCategoryWithDetails([makeQuestion(1, true, 1000)]),
      coding: makeCategoryWithDetails([makeQuestion(1, true, 1000)]),
      instructionFollowing: makeCategoryWithDetails([makeQuestion(1, true, 1000)]),
      structuredOutput: makeCategoryWithDetails([makeQuestion(1, true, 1000)]),
      multilingual: makeCategoryWithDetails([makeQuestion(1, true, 1000)]),
    };

    // Same but reasoning answers are slow
    const slowQuality: QualityMetrics = {
      ...fastQuality,
      reasoning: makeCategoryWithDetails([
        makeQuestion(1, true, 50000),  // slow
        makeQuestion(2, true, 50000),  // slow
      ]),
    };

    const fastScore = computeQualityScore(fastQuality);
    const slowScore = computeQualityScore(slowQuality);

    expect(fastScore.total).toBeGreaterThan(slowScore.total);
    expect(fastScore.reasoning).toBeGreaterThan(slowScore.reasoning);
  });
});
