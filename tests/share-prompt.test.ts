/**
 * Test intent:
 * - Validate share prompt decision logic and saved preferences.
 *
 * Why it matters:
 * - Sharing is optional and user-controlled; wrong behavior harms trust.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchResult } from "../src/types.js";

const { loadConfigMock, saveConfigMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  saveConfigMock: vi.fn(),
}));

vi.mock("../src/core/store.js", () => ({
  loadConfig: loadConfigMock,
  saveConfig: saveConfigMock,
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
  const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;

  const setTTY = (value: boolean) => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value,
    });
  };

  async function runInteractivePromptWithKeys(
    keys: Array<{ str: string; key: { name?: string; ctrl?: boolean } }>
  ): Promise<"share" | "skip"> {
    setTTY(true);
    const stdinStream = process.stdin as NodeJS.ReadStream & {
      setRawMode?: (mode: boolean) => void;
      isRaw?: boolean;
    };
    const originalSetRawMode = stdinStream.setRawMode;
    const originalIsRaw = stdinStream.isRaw;

    stdinStream.setRawMode = (mode: boolean) => {
      stdinStream.isRaw = mode;
    };

    try {
      const pendingDecision = promptShare(sampleResult());
      await new Promise((resolve) => setImmediate(resolve));

      for (const inputKey of keys) {
        process.stdin.emit("keypress", inputKey.str, inputKey.key);
      }

      return await pendingDecision;
    } finally {
      if (originalSetRawMode) {
        stdinStream.setRawMode = originalSetRawMode;
      } else {
        delete stdinStream.setRawMode;
      }
      stdinStream.isRaw = originalIsRaw;
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockResolvedValue({ autoShare: "ask", autoSharePreferenceSet: true });
    saveConfigMock.mockResolvedValue(undefined);
    setTTY(false);
  });

  afterEach(() => {
    if (stdinTtyDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
    } else {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalStdinIsTTY,
      });
    }

    if (stdoutTtyDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
    } else {
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: originalStdoutIsTTY,
      });
    }
  });

  it("returns share when autoShare is true", async () => {
    loadConfigMock.mockResolvedValueOnce({ autoShare: true });
    const decision = await promptShare(sampleResult());
    expect(decision).toBe("share");
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("returns skip in non-interactive mode when autoShare is ask", async () => {
    loadConfigMock.mockResolvedValueOnce({ autoShare: "ask", autoSharePreferenceSet: true });
    const decision = await promptShare(sampleResult());
    expect(decision).toBe("skip");
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("does not treat legacy false as persistent opt-out", async () => {
    setTTY(true);
    loadConfigMock.mockResolvedValueOnce({ autoShare: false });
    const selectChoice = vi.fn(async () => "share");
    const decision = await promptShare(sampleResult(), { selectChoice });
    expect(decision).toBe("share");
    expect(selectChoice).toHaveBeenCalledTimes(1);
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("stores always preference when user chooses 'a'", async () => {
    setTTY(true);
    const decision = await promptShare(sampleResult(), {
      selectChoice: vi.fn(async () => "always"),
    });
    expect(decision).toBe("share");
    expect(saveConfigMock).toHaveBeenCalledWith({ autoShare: true, autoSharePreferenceSet: true });
  });

  it("returns share when user chooses one-time share", async () => {
    setTTY(true);
    const decision = await promptShare(sampleResult(), {
      selectChoice: vi.fn(async () => "share"),
    });
    expect(decision).toBe("share");
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("returns skip when user chooses one-time skip without saving", async () => {
    setTTY(true);
    const decision = await promptShare(sampleResult(), {
      selectChoice: vi.fn(async () => "skip"),
    });
    expect(decision).toBe("skip");
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("supports numpad selection for immediate share", async () => {
    const decision = await runInteractivePromptWithKeys([
      { str: "", key: { name: "numpad1" } },
    ]);
    expect(decision).toBe("share");
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("supports arrow navigation then Enter for always-share", async () => {
    const decision = await runInteractivePromptWithKeys([
      { str: "", key: { name: "down" } },
      { str: "", key: { name: "down" } },
      { str: "\r", key: { name: "return" } },
    ]);
    expect(decision).toBe("share");
    expect(saveConfigMock).toHaveBeenCalledWith({ autoShare: true, autoSharePreferenceSet: true });
  });

  it("accepts enter alias for validation key", async () => {
    const decision = await runInteractivePromptWithKeys([
      { str: "\r", key: { name: "enter" } },
    ]);
    expect(decision).toBe("share");
  });

  it("accepts numpad enter alias for validation key", async () => {
    const decision = await runInteractivePromptWithKeys([
      { str: "", key: { name: "numenter" } },
    ]);
    expect(decision).toBe("share");
  });
});
