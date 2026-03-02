/**
 * Test intent:
 * - Validate local persistence (results + config) in an isolated home directory.
 *
 * Why it matters:
 * - Local history and share preferences are core UX features.
 * - Broken persistence causes confusing behavior across runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BenchResult } from "../src/types.js";

let fakeHome = "";
let prevHome: string | undefined;
let prevUserProfile: string | undefined;

function sampleResult(model = "qwen2.5:7b"): BenchResult {
  return {
    model,
    hardware: {
      cpu: "CPU",
      cpuCores: 8,
      cpuPCores: null,
      cpuECores: null,
      cpuFreqGHz: null,
      totalMemoryGB: 32,
      freeMemoryGB: 16,
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
      tokensPerSecond: 40,
      ttft: 800,
      loadTime: 2000,
      totalTokens: 500,
      promptTokens: 100,
      completionTokens: 400,
      memoryUsedGB: 10,
      memoryPercent: 31,
    },
    quality: null,
    fitness: {
      verdict: "GOOD",
      globalScore: null,
      hardwareFitScore: 72,
      performanceScore: { total: 72, speed: 30, ttft: 24, memory: 18 },
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

describe("store", () => {
  beforeEach(async () => {
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    fakeHome = await mkdtemp(join(tmpdir(), "metrillm-store-home-"));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    vi.resetModules();
  });

  afterEach(async () => {
    if (prevHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prevHome;
    }
    if (prevUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = prevUserProfile;
    }
    if (fakeHome) {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("saves and loads benchmark results", async () => {
    const store = await import("../src/core/store.js");
    const first = sampleResult("qwen2.5:7b");
    const second = sampleResult("llama3.1:8b");

    const firstPath = await store.saveResult(first);
    const secondPath = await store.saveResult(second);

    expect(firstPath).toContain(".metrillm/results");
    expect(secondPath).toContain(".metrillm/results");

    const loaded = await store.loadResults();
    expect(loaded).toHaveLength(2);
    expect(loaded.map((r) => r.model).sort()).toEqual(["llama3.1:8b", "qwen2.5:7b"]);
  });

  it("returns default config then persists config updates", async () => {
    const store = await import("../src/core/store.js");
    const defaultConfig = await store.loadConfig();
    expect(defaultConfig.autoShare).toBe("ask");

    await store.saveConfig({ autoShare: true });
    const updated = await store.loadConfig();
    expect(updated.autoShare).toBe(true);
  });

  it("normalizes and keeps submitter profile when valid", async () => {
    const store = await import("../src/core/store.js");
    await store.saveConfig({
      autoShare: "ask",
      submitterNickname: "  Cyril   Bench  ",
      submitterEmail: "  CYRIL@Example.COM ",
    });

    const updated = await store.loadConfig();
    expect(updated.submitterNickname).toBe("Cyril Bench");
    expect(updated.submitterEmail).toBe("cyril@example.com");
  });

  it("drops invalid submitter profile fields from config", async () => {
    const store = await import("../src/core/store.js");
    const configPath = join(fakeHome, ".metrillm", "config.json");
    await mkdir(join(fakeHome, ".metrillm"), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      autoShare: "ask",
      submitterNickname: "x",
      submitterEmail: "invalid-email",
    }), "utf8");

    const config = await store.loadConfig();
    expect(config.submitterNickname).toBeUndefined();
    expect(config.submitterEmail).toBeUndefined();
  });

  it("normalizes legacy autoShare=false to ask", async () => {
    const store = await import("../src/core/store.js");
    const configPath = join(fakeHome, ".metrillm", "config.json");
    await mkdir(join(fakeHome, ".metrillm"), { recursive: true });
    await writeFile(configPath, JSON.stringify({ autoShare: false }), "utf8");

    const config = await store.loadConfig();
    expect(config.autoShare).toBe("ask");
  });

  it("ignores malformed result files", async () => {
    const store = await import("../src/core/store.js");
    const path = await store.saveResult(sampleResult("mixtral:8x7b"));
    const dir = store.getResultsDir();
    await writeFile(join(dir, "bad.json"), "{ this-is: not-json", "utf8");
    const rawSaved = await readFile(path, "utf8");
    expect(rawSaved).toContain("mixtral:8x7b");

    const loaded = await store.loadResults();
    expect(loaded.some((r) => r.model === "mixtral:8x7b")).toBe(true);
  });

  it("uses unique filenames for same model and timestamp", async () => {
    const store = await import("../src/core/store.js");
    const first = sampleResult("qwen2.5:7b");
    const second = {
      ...sampleResult("qwen2.5:7b"),
      metadata: {
        ...sampleResult("qwen2.5:7b").metadata,
        rawLogHash: "def456",
      },
    };

    const firstPath = await store.saveResult(first);
    const secondPath = await store.saveResult(second);

    expect(firstPath).not.toBe(secondPath);

    const loaded = await store.loadResults();
    expect(loaded.filter((r) => r.model === "qwen2.5:7b")).toHaveLength(2);
  });
});
