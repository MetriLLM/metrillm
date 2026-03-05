/**
 * Test intent:
 * - Verify export generation for JSON, CSV, and Markdown formats.
 * - Confirm files are created and contain expected benchmark fields.
 *
 * Why it matters:
 * - Export is used for sharing results and CI/report pipelines.
 * - Format regressions can break downstream tooling and reporting.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportBenchResults } from "../src/core/exporter.js";
import type { BenchResult } from "../src/types.js";

const tmpDirs: string[] = [];

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sampleResult(): BenchResult {
  return {
    model: "llama3.2:3b",
    modelInfo: {
      parameterSize: "3.2B",
      quantization: "Q4_0",
      family: "llama",
    },
    hardware: {
      cpu: "Test CPU",
      cpuCores: 8,
      cpuPCores: null,
      cpuECores: null,
      cpuFreqGHz: null,
      totalMemoryGB: 32,
      freeMemoryGB: 16,
      memoryType: null,
      swapTotalGB: 4,
      swapUsedGB: 0,
      gpu: "Test GPU",
      gpuCores: null,
      gpuVramMB: null,
      os: "TestOS 1.0",
      arch: "arm64",
    },
    performance: {
      tokensPerSecond: 42.5,
      ttft: 950,
      loadTime: 1200,
      totalTokens: 550,
      promptTokens: 150,
      completionTokens: 400,
      memoryUsedGB: 10.2,
      memoryPercent: 31.9,
    },
    quality: null,
    fitness: {
      verdict: "GOOD",
      globalScore: null,
      hardwareFitScore: 66,
      performanceScore: { total: 66, speed: 28, ttft: 20, memory: 18 },
      qualityScore: null,
      categoryLabels: null,
      disqualifiers: [],
      warnings: [],
      interpretation: "Runs well on this hardware (HW 66/100). Run full benchmarks for quality assessment.",
      tuning: {
        profile: "BALANCED",
        speed: { excellent: 30, good: 16, marginal: 7, hardMin: 5 },
        ttft: { excellentMs: 1000, goodMs: 2200, marginalMs: 5000, hardMaxMs: 15000 },
        loadTimeHardMaxMs: 180000,
      },
    },
    timestamp: "2026-02-27T18:00:00.000Z",
  };
}

describe("exportBenchResults", () => {
  it("exports JSON", async () => {
    const dir = await makeTmpDir("metrillm-export-json-");
    const path = await exportBenchResults([sampleResult()], "json", dir);
    const content = await readFile(path, "utf8");
    expect(content).toContain("\"model\": \"llama3.2:3b\"");
    expect(content).toContain("\"verdict\": \"GOOD\"");
  });

  it("exports CSV", async () => {
    const dir = await makeTmpDir("metrillm-export-csv-");
    const path = await exportBenchResults([sampleResult()], "csv", dir);
    const content = await readFile(path, "utf8");
    expect(content).toContain("model,parameter_size,quantization,family,thinking_detected,timestamp");
    expect(content).toContain("model_memory_estimated");
    expect(content).toContain("hardware_fit_score");
    expect(content).toContain("global_score");
    expect(content).toContain("llama3.2:3b");
    expect(content).toContain("Q4_0");
    expect(content).toContain("3.2B");
    expect(content).toContain("GOOD");
  });

  it("exports explicit non-thinking mode in CSV", async () => {
    const dir = await makeTmpDir("metrillm-export-csv-thinking-");
    const path = await exportBenchResults(
      [
        {
          ...sampleResult(),
          modelInfo: {
            ...sampleResult().modelInfo,
            thinkingDetected: false,
          },
        },
      ],
      "csv",
      dir
    );
    const content = await readFile(path, "utf8");
    expect(content).toContain(",false,");
  });

  it("exports Markdown", async () => {
    const dir = await makeTmpDir("metrillm-export-md-");
    const path = await exportBenchResults([sampleResult()], "md", dir);
    const content = await readFile(path, "utf8");
    expect(content).toContain("# MetriLLM Benchmark Results");
    expect(content).toContain("| Quant |");
    expect(content).toContain("| Machine |");
    expect(content).toContain("| Flags |");
    expect(content).toContain("| Model RAM% |");
    expect(content).toContain("llama3.2:3b | Q4_0 |");
    expect(content).toContain("GOOD");
    expect(content).toContain("Global");
  });

  it("exports Markdown summary with model memory and estimated throughput marker", async () => {
    const dir = await makeTmpDir("metrillm-export-md-estimated-");
    const result: BenchResult = {
      ...sampleResult(),
      performance: {
        ...sampleResult().performance,
        tokensPerSecondEstimated: true,
        memoryPercent: 31.9,
        memoryFootprintEstimated: true,
        memoryHostPercent: 88.2,
      },
    };

    const path = await exportBenchResults([result], "md", dir);
    const content = await readFile(path, "utf8");

    expect(content).toContain("~42.5");
    expect(content).toContain("31.9%");
    expect(content).toContain("(est.)");
    expect(content).toContain("TPS~");
    expect(content).not.toContain("88.2%");
  });

  it("exports blank model memory percent when the footprint is unavailable", async () => {
    const dir = await makeTmpDir("metrillm-export-csv-no-memory-");
    const path = await exportBenchResults(
      [
        {
          ...sampleResult(),
          performance: {
            ...sampleResult().performance,
            memoryPercent: 0,
            memoryFootprintAvailable: false,
          },
        },
      ],
      "csv",
      dir
    );
    const content = await readFile(path, "utf8");
    expect(content).toContain("model_memory_percent,model_memory_estimated,host_memory_percent");
    expect(content).toContain("950,,,");
  });

  it("exports N/A model memory in Markdown when the footprint is unavailable", async () => {
    const dir = await makeTmpDir("metrillm-export-md-no-memory-");
    const path = await exportBenchResults(
      [
        {
          ...sampleResult(),
          performance: {
            ...sampleResult().performance,
            memoryPercent: 0,
            memoryFootprintAvailable: false,
          },
        },
      ],
      "md",
      dir
    );
    const content = await readFile(path, "utf8");
    expect(content).toContain("| N/A |");
    expect(content).not.toContain("| 0.0% |");
  });

  it("keeps markdown summary table valid with multiple models", async () => {
    const first = sampleResult();
    const second: BenchResult = {
      ...sampleResult(),
      model: "qwen2.5:7b",
      timestamp: "2026-02-27T18:10:00.000Z",
      fitness: {
        ...sampleResult().fitness,
        verdict: "MARGINAL",
        globalScore: 42,
        hardwareFitScore: 48,
        performanceScore: { total: 48, speed: 18, ttft: 16, memory: 14 },
        disqualifiers: ["Token speed too low for comfortable iterative usage."],
        interpretation: "Model runs, but latency is noticeable on this host.",
      },
    };

    const dir = await makeTmpDir("metrillm-export-md-multi-");
    const path = await exportBenchResults([first, second], "md", dir);
    const content = await readFile(path, "utf8");
    const lines = content.split("\n");

    const tableStart = lines.findIndex((l) => l.startsWith("| Model |"));
    expect(tableStart).toBeGreaterThan(-1);
    const nextBlank = lines
      .slice(tableStart + 1)
      .findIndex((l) => l.trim() === "");
    const tableEnd = nextBlank === -1 ? lines.length : tableStart + 1 + nextBlank;
    const tableBlock = lines.slice(tableStart, tableEnd);

    expect(tableBlock.every((l) => l.startsWith("|"))).toBe(true);
    expect(tableBlock.some((l) => l.includes("| llama3.2:3b |"))).toBe(true);
    expect(tableBlock.some((l) => l.includes("| qwen2.5:7b |"))).toBe(true);

    expect(content).toContain("## Interpretation");
    expect(content).toContain("## Disqualifiers");
    expect(content).toContain("### qwen2.5:7b");
  });

  it("neutralizes CSV formula injection in text cells", async () => {
    const malicious: BenchResult = {
      ...sampleResult(),
      model: "=HYPERLINK(\"https://malicious.example\")",
    };
    const dir = await makeTmpDir("metrillm-export-csv-safe-");
    const path = await exportBenchResults([malicious], "csv", dir);
    const content = await readFile(path, "utf8");

    expect(content).toContain("'=HYPERLINK");
  });

  it("neutralizes CSV formula injection with leading spaces", async () => {
    const malicious: BenchResult = {
      ...sampleResult(),
      model: "   =cmd|'/C calc'!A0",
    };
    const dir = await makeTmpDir("metrillm-export-csv-safe-leading-");
    const path = await exportBenchResults([malicious], "csv", dir);
    const content = await readFile(path, "utf8");

    expect(content).toContain("'   =cmd|'/C calc'!A0");
  });

  it("escapes markdown pipe characters in table cells", async () => {
    const withPipes: BenchResult = {
      ...sampleResult(),
      model: "my|model",
      fitness: {
        ...sampleResult().fitness,
        verdict: "GOOD | CHECK",
      },
    };
    const dir = await makeTmpDir("metrillm-export-md-escape-");
    const path = await exportBenchResults([withPipes], "md", dir);
    const content = await readFile(path, "utf8");

    expect(content).toContain("my\\|model");
    expect(content).toContain("GOOD \\| CHECK");
  });
});
