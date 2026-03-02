/**
 * Test intent:
 * - Ensure UI rendering functions print expected sections without throwing.
 * - Verify key user-facing text like banner metadata and verdict labels.
 *
 * Why it matters:
 * - CLI UX is the primary interface; broken rendering harms usability.
 * - These tests catch accidental output regressions in the reporting layer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HardwareInfo, PerformanceMetrics, QualityMetrics, FitnessResult, BenchResult } from "../src/types.js";

// Mock console.log to capture output
let output: string[] = [];
beforeEach(() => {
  output = [];
  vi.spyOn(console, "log").mockImplementation((...args) => {
    output.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("printBanner", () => {
  it("prints banner without throwing", async () => {
    const { printBanner } = await import("../src/ui/banner.js");
    expect(() => printBanner()).not.toThrow();
    expect(output.length).toBeGreaterThan(0);
    expect(output.some((l) => l.includes("Benchmark"))).toBe(true);
    expect(output.some((l) => l.includes("2026 MetriLLM"))).toBe(true);
    expect(output.some((l) => l.includes("github.com"))).toBe(true);
    expect(output.some((l) => l.includes("Leaderboard:"))).toBe(true);
  });
});

describe("printHardwareTable", () => {
  it("prints hardware info", async () => {
    const { printHardwareTable } = await import("../src/ui/results-table.js");
    const hw: HardwareInfo = {
      cpu: "Apple M4 Pro",
      cpuCores: 12,
      cpuPCores: 10,
      cpuECores: 4,
      cpuFreqGHz: 2.4,
      totalMemoryGB: 64,
      freeMemoryGB: 32,
      memoryType: "LPDDR5",
      swapTotalGB: 8,
      swapUsedGB: 1.2,
      gpu: "Apple M4 Pro",
      gpuCores: 20,
      gpuVramMB: null,
      os: "macOS 15.0",
      arch: "arm64",
    };
    expect(() => printHardwareTable(hw)).not.toThrow();
    const joined = output.join("\n");
    expect(joined).toContain("Apple M4 Pro");
    expect(joined).toContain("64");
  });
});

describe("printPerformanceTable", () => {
  it("prints performance metrics", async () => {
    const { printPerformanceTable } = await import("../src/ui/results-table.js");
    const perf: PerformanceMetrics = {
      tokensPerSecond: 45.2,
      ttft: 800,
      loadTime: 2000,
      totalTokens: 500,
      promptTokens: 100,
      completionTokens: 400,
      memoryUsedGB: 16,
      memoryPercent: 25,
    };
    expect(() => printPerformanceTable(perf)).not.toThrow();
    const joined = output.join("\n");
    expect(joined).toContain("45.2");
  });
});

describe("printQualityTable", () => {
  it("prints quality metrics with 6 categories", async () => {
    const { printQualityTable } = await import("../src/ui/results-table.js");
    const quality: QualityMetrics = {
      reasoning: { score: 80, correct: 20, total: 25, details: [] },
      math: { score: 70, correct: 17, total: 25, details: [] },
      coding: { score: 60, correct: 9, total: 15, details: [] },
      instructionFollowing: { score: 75, correct: 15, total: 20, details: [] },
      structuredOutput: { score: 65, correct: 10, total: 15, details: [] },
      multilingual: { score: 55, correct: 11, total: 20, details: [] },
    };
    expect(() => printQualityTable(quality)).not.toThrow();
    const joined = output.join("\n");
    expect(joined).toContain("Reasoning");
    expect(joined).toContain("Math");
    expect(joined).toContain("Coding");
    expect(joined).toContain("Instruction Following");
    expect(joined).toContain("Structured Output");
    expect(joined).toContain("Multilingual");
  });
});

describe("printVerdict", () => {
  it("prints verdict with 3 sections", async () => {
    const { printVerdict } = await import("../src/ui/verdict.js");
    const fitness: FitnessResult = {
      verdict: "EXCELLENT",
      globalScore: 92,
      hardwareFitScore: 90,
      performanceScore: { total: 90, speed: 38, ttft: 28, memory: 24 },
      qualityScore: { total: 93, reasoning: 18, coding: 19, instructionFollowing: 19, structuredOutput: 14, math: 14, multilingual: 9 },
      categoryLabels: [
        { category: "Reasoning", rawScore: 90, level: "Strong" },
        { category: "Coding", rawScore: 95, level: "Strong" },
        { category: "Instruction Following", rawScore: 95, level: "Strong" },
        { category: "Structured Output", rawScore: 93, level: "Strong" },
        { category: "Math", rawScore: 93, level: "Strong" },
        { category: "Multilingual", rawScore: 90, level: "Strong" },
      ],
      disqualifiers: [],
      warnings: [],
      interpretation: "Runs excellently on this hardware (HW 90/100).",
      tuning: {
        profile: "HIGH-END",
        speed: { excellent: 45, good: 25, marginal: 12, hardMin: 6 },
        ttft: { excellentMs: 700, goodMs: 1600, marginalMs: 3500, hardMaxMs: 12000 },
        loadTimeHardMaxMs: 120000,
      },
    };
    expect(() => printVerdict("test-model", fitness)).not.toThrow();
    const joined = output.join("\n");
    expect(joined).toContain("VERDICT for");
    expect(joined).toContain("EXCELLENT");
    expect(joined).toContain("test-model");
    expect(joined).toContain("A) Hardware Fit");
    expect(joined).toContain("B) Task Quality");
    expect(joined).toContain("C) Global Score");
    expect(joined).toContain("Method: thresholds are adjusted");
    expect(joined).toContain("Active profile: HIGH-END");
  });

  it("prints disqualifiers when present", async () => {
    const { printVerdict } = await import("../src/ui/verdict.js");
    const fitness: FitnessResult = {
      verdict: "NOT RECOMMENDED",
      globalScore: null,
      hardwareFitScore: 15,
      performanceScore: { total: 15, speed: 3, ttft: 7, memory: 5 },
      qualityScore: null,
      categoryLabels: null,
      disqualifiers: ["Token speed too low: 2.0 tok/s"],
      warnings: [],
      interpretation: "Runs poorly on this hardware (HW 15/100). Run full benchmarks for quality assessment.",
      tuning: {
        profile: "BALANCED",
        speed: { excellent: 30, good: 16, marginal: 7, hardMin: 5 },
        ttft: { excellentMs: 1000, goodMs: 2200, marginalMs: 5000, hardMaxMs: 15000 },
        loadTimeHardMaxMs: 180000,
      },
    };
    expect(() => printVerdict("slow-model", fitness)).not.toThrow();
    const joined = output.join("\n");
    expect(joined).toContain("NOT RECOMMENDED");
    expect(joined).toContain("Token speed too low");
  });

  it("keeps category score and level on one rendered line", async () => {
    const { printVerdict } = await import("../src/ui/verdict.js");
    const fitness: FitnessResult = {
      verdict: "GOOD",
      globalScore: 72,
      hardwareFitScore: 83,
      performanceScore: { total: 83, speed: 33, ttft: 26, memory: 24 },
      qualityScore: { total: 55, reasoning: 7, coding: 13, instructionFollowing: 15, structuredOutput: 12, math: 1, multilingual: 7 },
      categoryLabels: [
        { category: "Reasoning", rawScore: 32, level: "Weak" },
        { category: "Coding", rawScore: 63, level: "Adequate" },
        { category: "Instruction Following", rawScore: 75, level: "Strong" },
        { category: "Structured Output", rawScore: 80, level: "Strong" },
        { category: "Math", rawScore: 8, level: "Poor" },
        { category: "Multilingual", rawScore: 75, level: "Strong" },
      ],
      disqualifiers: [],
      warnings: [],
      interpretation: "Runs well enough on this hardware (HW 83/100).",
      tuning: {
        profile: "BALANCED",
        speed: { excellent: 30, good: 16, marginal: 7, hardMin: 5 },
        ttft: { excellentMs: 1000, goodMs: 2200, marginalMs: 5000, hardMaxMs: 15000 },
        loadTimeHardMaxMs: 180000,
      },
    };

    printVerdict("weak-line-check", fitness);

    const reasoningLine = output.find((line) => line.includes("Reasoning"));
    expect(reasoningLine).toBeDefined();
    expect(reasoningLine).toContain("32%");
    expect(reasoningLine).toContain("Weak");
  });
});

describe("printSummaryTable", () => {
  it("prints Global column and new verdict labels", async () => {
    const { printSummaryTable } = await import("../src/ui/results-table.js");

    const base: BenchResult = {
      model: "model-a",
      hardware: {
        cpu: "CPU",
        cpuCores: 8,
        cpuPCores: null,
        cpuECores: null,
        cpuFreqGHz: null,
        totalMemoryGB: 32,
        freeMemoryGB: 16,
        memoryType: null,
        swapTotalGB: 0,
        swapUsedGB: 0,
        gpu: "GPU",
        gpuCores: null,
        gpuVramMB: null,
        os: "OS",
        arch: "arm64",
      },
      performance: {
        tokensPerSecond: 40,
        ttft: 900,
        loadTime: 2000,
        totalTokens: 500,
        promptTokens: 100,
        completionTokens: 400,
        memoryUsedGB: 10,
        memoryPercent: 35,
      },
      quality: null,
      fitness: {
        verdict: "GOOD",
        globalScore: 68,
        hardwareFitScore: 74,
        performanceScore: { total: 74, speed: 30, ttft: 24, memory: 20 },
        qualityScore: { total: 64, reasoning: 14, coding: 12, instructionFollowing: 13, structuredOutput: 10, math: 9, multilingual: 6 },
        categoryLabels: [
          { category: "Reasoning", rawScore: 70, level: "Adequate" },
          { category: "Coding", rawScore: 60, level: "Adequate" },
          { category: "Instruction Following", rawScore: 65, level: "Adequate" },
          { category: "Structured Output", rawScore: 67, level: "Adequate" },
          { category: "Math", rawScore: 60, level: "Adequate" },
          { category: "Multilingual", rawScore: 60, level: "Adequate" },
        ],
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
      timestamp: "2026-02-27T00:00:00.000Z",
    };

    printSummaryTable([
      base,
      {
        ...base,
        model: "model-b",
        fitness: { ...base.fitness, verdict: "EXCELLENT", globalScore: 92, hardwareFitScore: 90, qualityScore: null, categoryLabels: null },
      },
    ]);

    const joined = output.join("\n");
    expect(joined).toContain("Global");
    expect(joined).toContain("HW Fit");
    expect(joined).toContain("Quality");
    expect(joined).toContain("model-a");
    expect(joined).toContain("model-b");
  });
});
