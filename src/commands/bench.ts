import { createHash } from "node:crypto";
import chalk from "chalk";
import { listModels, getOllamaVersion } from "../core/ollama-client.js";
import { getHardwareInfo } from "../core/hardware.js";
import { runPerformanceBench } from "../benchmarks/performance.js";
import { runReasoningBench } from "../benchmarks/reasoning.js";
import { runMathBench } from "../benchmarks/math.js";
import { runCodingBench } from "../benchmarks/coding.js";
import { runInstructionFollowingBench } from "../benchmarks/instruction-following.js";
import { runStructuredOutputBench } from "../benchmarks/structured-output.js";
import { runMultilingualBench } from "../benchmarks/multilingual.js";
import { computeFitness } from "../scoring/fitness.js";
import { printHardwareTable, printPerformanceTable, printQualityTable, printSummaryTable } from "../ui/results-table.js";
import { printVerdict } from "../ui/verdict.js";
import { stepHeader, errorMsg, warnMsg, createSpinner, successMsg } from "../ui/progress.js";
import { saveResult } from "../core/store.js";
import { uploadBenchResult } from "../core/uploader.js";
import { promptShare } from "../ui/share-prompt.js";
import type { BenchResult, HardwareInfo, ModelInfo, OllamaModel, QualityMetrics, RunMetadata } from "../types.js";

const BENCHMARK_SPEC_VERSION = "0.1.0";
const PROMPT_PACK_VERSION = "0.1.0";

export interface BenchOptions {
  model?: string;
  perfOnly?: boolean;
  setExitCode?: boolean;
  perfWarmupTimeoutMs?: number;
  perfPromptTimeoutMs?: number;
  perfMinSuccessfulPrompts?: number;
  perfStrict?: boolean;
  share?: boolean;       // true = --share, false = --no-share, undefined = prompt
  ciNoMenu?: boolean;    // running in CI mode
}

export interface BenchOutcome {
  results: BenchResult[];
  failedModels: string[];
}

export async function benchCommand(options: BenchOptions): Promise<BenchOutcome> {
  const shouldSetExitCode = options.setExitCode !== false;

  // Detect hardware
  stepHeader("Hardware Detection");
  const spinner = createSpinner("Detecting hardware...");
  spinner.start();
  let hardware: HardwareInfo;
  try {
    hardware = await getHardwareInfo();
    spinner.succeed("Hardware detected");
    printHardwareTable(hardware);
  } catch (err) {
    spinner.fail("Hardware detection failed");
    if (err instanceof Error) errorMsg(err.message);
    if (shouldSetExitCode) process.exitCode = 1;
    return { results: [], failedModels: [] };
  }

  // Detect Ollama version
  let runtimeVersion = "unknown";
  try {
    runtimeVersion = await getOllamaVersion();
  } catch (err) {
    warnMsg("Could not detect Ollama version (continuing with runtimeVersion=unknown).");
    if (err instanceof Error) warnMsg(err.message);
  }

  // Determine which models to bench
  let modelNames: string[];
  let allModels: OllamaModel[] = [];
  if (options.model) {
    modelNames = [options.model];
    try {
      allModels = await listModels();
    } catch {
      // Non-fatal: model info is optional
    }
  } else {
    stepHeader("Discovering Models");
    const spinnerModels = createSpinner("Fetching model list...");
    spinnerModels.start();
    try {
      allModels = await listModels();
      modelNames = allModels.map((m) => m.name);
      spinnerModels.succeed(`Found ${allModels.length} model(s)`);
    } catch (err) {
      spinnerModels.fail("Failed to connect to Ollama");
      errorMsg("Make sure Ollama is running: ollama serve");
      if (err instanceof Error) errorMsg(err.message);
      if (shouldSetExitCode) process.exitCode = 1;
      return { results: [], failedModels: [] };
    }

    if (modelNames.length === 0) {
      errorMsg("No models found. Pull one with: ollama pull <model>");
      if (shouldSetExitCode) process.exitCode = 1;
      return { results: [], failedModels: [] };
    }
  }

  // Run benchmarks for each model
  const results: BenchResult[] = [];
  const failedModels: string[] = [];

  for (const modelName of modelNames) {
    const label = `  Benchmarking: ${modelName}  `;
    const innerWidth = Math.max(label.length, 30);
    console.log(chalk.bold.cyan(`\n╔${"═".repeat(innerWidth)}╗`));
    console.log(chalk.bold.cyan(`║${label.padEnd(innerWidth)}║`));
    console.log(chalk.bold.cyan(`╚${"═".repeat(innerWidth)}╝`));

    try {
      // Performance benchmark
      stepHeader("Performance Benchmark");
      const perf = await runPerformanceBench(modelName, {
        warmupTimeoutMs: options.perfWarmupTimeoutMs,
        promptTimeoutMs: options.perfPromptTimeoutMs,
        minSuccessfulPrompts: options.perfMinSuccessfulPrompts,
        failOnPromptError: options.perfStrict,
      });
      printPerformanceTable(perf);

      // Quality benchmarks (unless --perf-only)
      let quality: QualityMetrics | null = null;
      if (!options.perfOnly) {
        stepHeader("Quality Benchmark — Reasoning");
        const reasoning = await runReasoningBench(modelName);

        stepHeader("Quality Benchmark — Math");
        const math = await runMathBench(modelName);

        stepHeader("Quality Benchmark — Coding");
        const coding = await runCodingBench(modelName);

        stepHeader("Quality Benchmark — Instruction Following");
        const instructionFollowing = await runInstructionFollowingBench(modelName);

        stepHeader("Quality Benchmark — Structured Output");
        const structuredOutput = await runStructuredOutputBench(modelName);

        stepHeader("Quality Benchmark — Multilingual");
        const multilingual = await runMultilingualBench(modelName);

        quality = { reasoning, math, coding, instructionFollowing, structuredOutput, multilingual };
      }

      // Compute fitness
      const fitness = computeFitness(perf, quality, hardware);
      if (quality) {
        printQualityTable(quality, fitness.qualityScore?.timePenalties);
      }
      printVerdict(modelName, fitness);

      // Build model info from discovered models
      const matchedModel = allModels.find((m) => m.name === modelName);
      const modelInfo: ModelInfo | undefined = matchedModel
        ? {
            parameterSize: matchedModel.parameterSize,
            quantization: matchedModel.quantization,
            family: matchedModel.family,
          }
        : undefined;

      // Build result without hash first, then compute hash
      const partialResult: Omit<BenchResult, "metadata"> & { metadata: Omit<RunMetadata, "rawLogHash"> } = {
        model: modelName,
        modelInfo,
        hardware,
        performance: perf,
        quality,
        fitness,
        timestamp: new Date().toISOString(),
        metadata: {
          benchmarkSpecVersion: BENCHMARK_SPEC_VERSION,
          promptPackVersion: PROMPT_PACK_VERSION,
          runtimeVersion,
        },
      };
      const rawLogHash = createHash("sha256")
        .update(JSON.stringify(partialResult))
        .digest("hex");

      const benchResult: BenchResult = {
        ...partialResult,
        metadata: { ...partialResult.metadata, rawLogHash },
      };
      results.push(benchResult);

      // Persist result locally
      try {
        const savedPath = await saveResult(benchResult);
        successMsg(`Result saved: ${savedPath}`);
      } catch {
        // Non-fatal: don't fail the benchmark if local save fails
      }
    } catch (err) {
      failedModels.push(modelName);
      errorMsg(`Failed to benchmark ${modelName}`);
      if (err instanceof Error) errorMsg(err.message);
    }
  }

  // Summary table if multiple models
  if (results.length > 1) {
    stepHeader("Summary");
    printSummaryTable(results);
  }

  if (failedModels.length > 0) {
    errorMsg(
      `Benchmark finished with ${failedModels.length} failure(s): ${failedModels.join(", ")}`
    );
    if (shouldSetExitCode) process.exitCode = 1;
  }

  // Share prompt for each result
  if (results.length > 0) {
    for (const result of results) {
      let decision: "share" | "skip" = "skip";

      if (options.share === false) {
        decision = "skip";
      } else if (options.share === true) {
        decision = "share";
      } else if (options.ciNoMenu) {
        // In CI mode, don't share by default (needs explicit --share)
        decision = "skip";
      } else {
        decision = await promptShare(result);
      }

      if (decision === "share") {
        const uploadSpinner = createSpinner("Uploading result...");
        uploadSpinner.start();
        try {
          const uploaded = await uploadBenchResult(result);
          uploadSpinner.succeed(`Shared! ${uploaded.url}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          uploadSpinner.fail(`Upload failed: ${msg}`);
          // Non-fatal: benchmark succeeded, upload is optional
        }
      }
    }
  }

  return { results, failedModels };
}
