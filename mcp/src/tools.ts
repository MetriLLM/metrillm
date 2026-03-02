import { z } from "zod";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { listModels } from "../../src/core/runtime.js";
import { benchCommand } from "../../src/commands/bench.js";
import { uploadBenchResult } from "../../src/core/uploader.js";
import type { BenchResult } from "../../src/types.js";

// ── Schemas ──

const SUPPORTED_RUNTIMES = ["ollama"] as const;

const runtimeSchema = z
  .enum(SUPPORTED_RUNTIMES)
  .optional()
  .default("ollama")
  .describe("Inference runtime to use. Currently only 'ollama' is supported.");

export const listModelsSchema = z.object({
  runtime: runtimeSchema,
});

export const runBenchmarkSchema = z.object({
  model: z.string().describe("Model name to benchmark (e.g. 'llama3.2:3b', 'qwen2.5:7b')"),
  runtime: runtimeSchema,
  perfOnly: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, skip quality benchmarks and only measure speed/memory/TTFT"),
});

export const getResultsSchema = z.object({
  model: z.string().optional().describe("Filter results by model name (substring match)"),
  runtime: runtimeSchema,
});

export const shareResultSchema = z.object({
  resultFile: z
    .string()
    .describe("Absolute path to a benchmark result JSON file (from ~/.llmeter/results/). Must be inside ~/.llmeter/results/."),
});

// ── Tool definitions for MCP registration ──

export const toolDefinitions = [
  {
    name: "list_models",
    description:
      "List all LLM models available locally on the inference runtime (e.g. Ollama). " +
      "Returns model name, size, parameter count, quantization, and family.",
    inputSchema: listModelsSchema,
  },
  {
    name: "run_benchmark",
    description:
      "Run an LLMeter benchmark on a local model. Measures performance (tokens/s, TTFT, memory) " +
      "and optionally quality (reasoning, math, coding, instruction following, structured output, multilingual). " +
      "Returns a detailed fitness verdict. Warning: benchmarks take 30s to 5+ minutes depending on model size.",
    inputSchema: runBenchmarkSchema,
  },
  {
    name: "get_results",
    description:
      "Retrieve previously saved benchmark results from ~/.llmeter/results/. " +
      "Optionally filter by model name. Returns an array of full benchmark result objects.",
    inputSchema: getResultsSchema,
  },
  {
    name: "share_result",
    description:
      "Upload a benchmark result to the public LLMeter leaderboard. " +
      "Requires LLMETER_SUPABASE_URL and LLMETER_SUPABASE_ANON_KEY environment variables. " +
      "The resultFile must be an absolute path to a JSON file in ~/.llmeter/results/.",
    inputSchema: shareResultSchema,
  },
] as const;

// ── Helpers ──

function assertRuntime(runtime: string): void {
  if (runtime !== "ollama") {
    throw new Error(
      `Runtime "${runtime}" is not yet supported. Currently supported: ${SUPPORTED_RUNTIMES.join(", ")}. ` +
        "New runtimes will be added as they become available in the LLMeter CLI."
    );
  }
}

const RESULTS_DIR = join(homedir(), ".llmeter", "results");

// ── Mutex for benchmark serialization ──
// The CLI uses a singleton runtime — concurrent benchmarks would corrupt results.
let benchLock: Promise<void> = Promise.resolve();

function withBenchLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = benchLock;
  let resolve: () => void;
  benchLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

// ── Tool handlers ──

export async function handleListModels(
  args: z.infer<typeof listModelsSchema>
): Promise<string> {
  assertRuntime(args.runtime);

  const models = await listModels();

  if (models.length === 0) {
    return JSON.stringify({
      models: [],
      message: "No models found. Pull one with: ollama pull <model>",
    });
  }

  return JSON.stringify({
    models: models.map((m) => ({
      name: m.name,
      size: m.size,
      parameterSize: m.parameterSize ?? null,
      quantization: m.quantization ?? null,
      family: m.family ?? null,
    })),
    count: models.length,
  });
}

export async function handleRunBenchmark(
  args: z.infer<typeof runBenchmarkSchema>
): Promise<string> {
  assertRuntime(args.runtime);

  return withBenchLock(async () => {
  const outcome = await benchCommand({
    model: args.model,
    perfOnly: args.perfOnly,
    json: true, // suppress all UI output
    share: false, // never auto-share from MCP
    setExitCode: false,
  });

  if (outcome.failedModels.length > 0) {
    return JSON.stringify({
      success: false,
      error: `Benchmark failed for: ${outcome.failedModels.join(", ")}`,
      failedModels: outcome.failedModels,
    });
  }

  if (outcome.results.length === 0) {
    return JSON.stringify({
      success: false,
      error: "No results produced. Is Ollama running? Is the model pulled?",
    });
  }

  const result = outcome.results[0];
  return JSON.stringify({
    success: true,
    model: result.model,
    verdict: result.fitness.verdict,
    globalScore: result.fitness.globalScore,
    performance: {
      tokensPerSecond: result.performance.tokensPerSecond,
      ttftMs: result.performance.ttft,
      memoryUsedGB: result.performance.memoryUsedGB,
      memoryPercent: result.performance.memoryPercent,
    },
    performanceScore: result.fitness.performanceScore,
    qualityScore: result.fitness.qualityScore,
    interpretation: result.fitness.interpretation,
    savedLocally: true,
  });
  }); // end withBenchLock
}

export async function handleGetResults(
  args: z.infer<typeof getResultsSchema>
): Promise<string> {
  assertRuntime(args.runtime);

  let files: string[];
  try {
    files = await readdir(RESULTS_DIR);
  } catch {
    return JSON.stringify({ results: [], message: "No results directory found (~/.llmeter/results/)" });
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();

  if (jsonFiles.length === 0) {
    return JSON.stringify({ results: [], message: "No benchmark results found." });
  }

  const results: Array<{
    file: string;
    model: string;
    verdict: string;
    globalScore: number | null;
    tokensPerSecond: number;
    timestamp: string;
  }> = [];

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(RESULTS_DIR, file), "utf8");
      const result = JSON.parse(content) as BenchResult;

      if (args.model && !result.model.toLowerCase().includes(args.model.toLowerCase())) {
        continue;
      }

      results.push({
        file: join(RESULTS_DIR, file),
        model: result.model,
        verdict: result.fitness.verdict,
        globalScore: result.fitness.globalScore,
        tokensPerSecond: result.performance.tokensPerSecond,
        timestamp: result.timestamp,
      });
    } catch {
      // Skip malformed files
    }
  }

  return JSON.stringify({ results, count: results.length });
}

export async function handleShareResult(
  args: z.infer<typeof shareResultSchema>
): Promise<string> {
  // Validate that the file is inside ~/.llmeter/results/ to prevent path traversal
  const { resolve } = await import("node:path");
  const resolvedPath = resolve(args.resultFile);
  const resolvedResultsDir = resolve(RESULTS_DIR);
  if (!resolvedPath.startsWith(resolvedResultsDir + "/")) {
    throw new Error(
      `Security: resultFile must be inside ${RESULTS_DIR}/. Got: ${args.resultFile}`
    );
  }

  let content: string;
  try {
    content = await readFile(resolvedPath, "utf8");
  } catch {
    throw new Error(`Cannot read result file: ${args.resultFile}`);
  }

  let result: BenchResult;
  try {
    result = JSON.parse(content) as BenchResult;
  } catch {
    throw new Error(`Invalid JSON in result file: ${args.resultFile}`);
  }

  if (!result.model || !result.performance || !result.fitness) {
    throw new Error("File does not appear to be a valid LLMeter benchmark result.");
  }

  const uploaded = await uploadBenchResult(result);

  return JSON.stringify({
    success: true,
    id: uploaded.id,
    url: uploaded.url,
    rankGlobalPct: uploaded.rankGlobalPct,
    rankCpuPct: uploaded.rankCpuPct,
    totalCount: uploaded.totalCount,
  });
}
