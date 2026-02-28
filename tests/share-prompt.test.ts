/**
 * Test intent:
 * - Validate share prompt decision logic and saved preferences.
 *
 * Why it matters:
 * - Sharing is optional and user-controlled; wrong behavior harms trust.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchResult } from "../src/types.js";

const { loadConfigMock, saveConfigMock, promptState } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  saveConfigMock: vi.fn(),
  promptState: { answer: "" },
}));

vi.mock("../src/core/store.js", () => ({
  loadConfig: loadConfigMock,
  saveConfig: saveConfigMock,
}));

vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(async () => promptState.answer),
    close: vi.fn(),
  })),
}));

import { promptShare } from "../src/ui/share-prompt.js";

function sampleResult(): BenchResult {
  return {
    model: "qwen2.5:7b",
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
      os: "TestOS",
      arch: "arm64",
    },
    performance: {
      tokensPerSecond: 42,
      ttft: 900,
      loadTime: 1200,
      totalTokens: 500,
      promptTokens: 120,
      completionTokens: 380,
      memoryUsedGB: 10,
      memoryPercent: 30,
    },
    quality: null,
    fitness: {
      verdict: "GOOD",
      globalScore: null,
      hardwareFitScore: 70,
      performanceScore: { total: 70, speed: 28, ttft: 23, memory: 19 },
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
      rawLogHash: "abc",
    },
  };
}

describe("promptShare", () => {
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const originalIsTTY = process.stdin.isTTY;

  const setTTY = (value: boolean) => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    promptState.answer = "";
    loadConfigMock.mockResolvedValue({ autoShare: "ask" });
    saveConfigMock.mockResolvedValue(undefined);
    setTTY(false);
  });

  afterEach(() => {
    if (ttyDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
    } else {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalIsTTY,
      });
    }
  });

  it("returns share when autoShare is true", async () => {
    loadConfigMock.mockResolvedValueOnce({ autoShare: true });
    const decision = await promptShare(sampleResult());
    expect(decision).toBe("share");
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("returns skip when autoShare is false", async () => {
    loadConfigMock.mockResolvedValueOnce({ autoShare: false });
    const decision = await promptShare(sampleResult());
    expect(decision).toBe("skip");
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("returns skip in non-interactive mode when autoShare is ask", async () => {
    const decision = await promptShare(sampleResult());
    expect(decision).toBe("skip");
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("stores always preference when user chooses 'a'", async () => {
    setTTY(true);
    promptState.answer = "a";
    const decision = await promptShare(sampleResult());
    expect(decision).toBe("share");
    expect(saveConfigMock).toHaveBeenCalledWith({ autoShare: true });
  });

  it("stores never preference when user chooses 'x'", async () => {
    setTTY(true);
    promptState.answer = "x";
    const decision = await promptShare(sampleResult());
    expect(decision).toBe("skip");
    expect(saveConfigMock).toHaveBeenCalledWith({ autoShare: false });
  });
});
