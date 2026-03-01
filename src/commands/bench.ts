import { createHash } from "node:crypto";
import chalk from "chalk";
import { listModels, getRuntimeVersion, setRuntimeKeepAlive, unloadModel } from "../core/runtime.js";
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
import { stepHeader, errorMsg, warnMsg, infoMsg, createSpinner, successMsg } from "../ui/progress.js";
import { saveResult } from "../core/store.js";
import { uploadBenchResult } from "../core/uploader.js";
import { promptShare } from "../ui/share-prompt.js";
import { resolveSubmitterForShare } from "../ui/submitter-prompt.js";
import { openUrl } from "../utils.js";
import { showTelemetryNotice, trackBenchStarted, trackBenchCompleted, trackBenchShared, flushTelemetry } from "../core/telemetry.js";
import type { BenchResult, HardwareInfo, ModelInfo, OllamaModel, QualityMetrics, RunMetadata } from "../types.js";

const BENCHMARK_SPEC_VERSION = "0.2.0";
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
  json?: boolean;        // output JSON only, no UI
  keepAlive?: string | number; // forwarded to Ollama keep_alive
  unloadAfterBench?: boolean;  // unload model after each model benchmark lifecycle
}

export interface BenchOutcome {
  results: BenchResult[];
  failedModels: string[];
}

export async function benchCommand(options: BenchOptions): Promise<BenchOutcome> {
  const shouldSetExitCode = options.setExitCode !== false;
  const silent = options.json === true;
  const shouldUnloadAfterModel =
    options.unloadAfterBench ?? (!options.model || options.ciNoMenu === true);

  // Detect hardware
  if (!silent) stepHeader("Hardware Detection");
  const spinner = createSpinner("Detecting hardware...");
  if (!silent) spinner.start();
  let hardware: HardwareInfo;
  try {
    hardware = await getHardwareInfo();
    if (!silent) {
      spinner.succeed("Hardware detected");
      printHardwareTable(hardware);
      if (hardware.powerMode === "low-power") {
        infoMsg("Low-power mode detected — results will reflect energy-saving performance.");
      }
      if (
        hardware.cpuCurrentSpeedGHz != null &&
        hardware.cpuFreqGHz != null &&
        hardware.cpuFreqGHz > 0 &&
        hardware.cpuCurrentSpeedGHz / hardware.cpuFreqGHz < 0.8
      ) {
        infoMsg(
          `CPU running at ${hardware.cpuCurrentSpeedGHz.toFixed(1)} GHz / ${hardware.cpuFreqGHz.toFixed(1)} GHz nominal — possible throttling.`
        );
      }
    }
  } catch (err) {
    if (!silent) spinner.fail("Hardware detection failed");
    if (!silent && err instanceof Error) errorMsg(err.message);
    if (shouldSetExitCode) process.exitCode = 1;
    return { results: [], failedModels: [] };
  }

  // Detect runtime version
  let runtimeVersion = "unknown";
  try {
    runtimeVersion = await getRuntimeVersion();
  } catch (err) {
    if (!silent) {
      warnMsg("Could not detect Ollama version (continuing with runtimeVersion=unknown).");
      if (err instanceof Error) warnMsg(err.message);
    }
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
    if (!silent) stepHeader("Discovering Models");
    const spinnerModels = createSpinner("Fetching model list...");
    if (!silent) spinnerModels.start();
    try {
      allModels = await listModels();
      modelNames = allModels.map((m) => m.name);
      if (!silent) spinnerModels.succeed(`Found ${allModels.length} model(s)`);
    } catch (err) {
      if (!silent) {
        spinnerModels.fail("Cannot connect to Ollama");
        errorMsg("Make sure Ollama is installed and running.");
        errorMsg("  • Start it with:  ollama serve");
        errorMsg("  • Install it at:  https://ollama.com");
        if (err instanceof Error) errorMsg(err.message);
      }
      if (shouldSetExitCode) process.exitCode = 1;
      return { results: [], failedModels: [] };
    }

    if (modelNames.length === 0) {
      if (!silent) errorMsg("No models found. Pull one with: ollama pull <model>");
      if (shouldSetExitCode) process.exitCode = 1;
      return { results: [], failedModels: [] };
    }
  }

  // Show one-time telemetry notice
  if (!silent) await showTelemetryNotice();

  setRuntimeKeepAlive(options.keepAlive);

  try {
    // Run benchmarks for each model
    const results: BenchResult[] = [];
    const failedModels: string[] = [];

    for (const modelName of modelNames) {
      if (!silent) {
        const label = `  Benchmarking: ${modelName}  `;
        const innerWidth = Math.max(label.length, 30);
        console.log(chalk.bold.cyan(`\n╔${"═".repeat(innerWidth)}╗`));
        console.log(chalk.bold.cyan(`║${label.padEnd(innerWidth)}║`));
        console.log(chalk.bold.cyan(`╚${"═".repeat(innerWidth)}╝`));
      }

      const benchStartTime = Date.now();
      await trackBenchStarted({
        model: modelName,
        os: hardware.os,
        arch: hardware.arch,
        cpuCores: hardware.cpuCores,
        ramGb: hardware.totalMemoryGB,
      });

      try {
        // Performance benchmark
        if (!silent) stepHeader("Performance Benchmark");
        const perfResult = await runPerformanceBench(modelName, {
          warmupTimeoutMs: options.perfWarmupTimeoutMs,
          promptTimeoutMs: options.perfPromptTimeoutMs,
          minSuccessfulPrompts: options.perfMinSuccessfulPrompts,
          failOnPromptError: options.perfStrict,
        });
        const perf = perfResult.metrics;
        const thinkingDetected = perfResult.thinkingDetected;
        if (!silent) printPerformanceTable(perf);

        // Quality benchmarks (unless --perf-only)
        let quality: QualityMetrics | null = null;
        if (!options.perfOnly) {
          if (!silent) stepHeader("Quality Benchmark — Reasoning");
          const reasoning = await runReasoningBench(modelName);

          if (!silent) stepHeader("Quality Benchmark — Math");
          const math = await runMathBench(modelName);

          if (!silent) stepHeader("Quality Benchmark — Coding");
          const coding = await runCodingBench(modelName);

          if (!silent) stepHeader("Quality Benchmark — Instruction Following");
          const instructionFollowing = await runInstructionFollowingBench(modelName);

          if (!silent) stepHeader("Quality Benchmark — Structured Output");
          const structuredOutput = await runStructuredOutputBench(modelName);

          if (!silent) stepHeader("Quality Benchmark — Multilingual");
          const multilingual = await runMultilingualBench(modelName);

          quality = { reasoning, math, coding, instructionFollowing, structuredOutput, multilingual };
        }

        // Compute fitness
        const fitness = computeFitness(perf, quality, hardware);
        if (!silent) {
          if (quality) {
            printQualityTable(quality, fitness.qualityScore?.timePenalties);
          }
          printVerdict(modelName, fitness);
        }

        // Build model info from discovered models
        const matchedModel = allModels.find((m) => m.name === modelName);
        const modelInfo: ModelInfo | undefined = matchedModel
          ? {
              parameterSize: matchedModel.parameterSize,
              quantization: matchedModel.quantization,
              family: matchedModel.family,
              ...(thinkingDetected ? { thinkingDetected } : {}),
            }
          : thinkingDetected
            ? { thinkingDetected }
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

        await trackBenchCompleted({
          model: modelName,
          verdict: fitness.verdict,
          globalScore: fitness.globalScore,
          tps: perf.tokensPerSecond,
          durationMs: Date.now() - benchStartTime,
        });

        // Persist result locally
        try {
          const savedPath = await saveResult(benchResult);
          if (!silent) successMsg(`Result saved: ${savedPath}`);
        } catch (err) {
          if (!silent) {
            warnMsg("Could not save benchmark result locally.");
            if (err instanceof Error) {
              warnMsg(err.message);
            }
          }
        }

        // Upload immediately after each model (when --share is enabled and quality was run)
        if (!options.perfOnly && !silent && options.share === true) {
          const uploadPayload: BenchResult = benchResult;
          const submitterEmail: string | undefined = undefined;

          const uploadSpinner = createSpinner("Uploading result...");
          uploadSpinner.start();
          try {
            const uploaded = await uploadBenchResult(uploadPayload, { submitterEmail });
            uploadSpinner.succeed(`Shared! ${uploaded.url}`);
            if (uploaded.rankGlobalPct != null) {
              const parts: string[] = [`Top ${uploaded.rankGlobalPct}% globally`];
              if (uploaded.rankCpuPct != null) {
                parts.push(`Top ${uploaded.rankCpuPct}% on ${benchResult.hardware.cpu}`);
              }
              successMsg(`  → ${parts.join(" · ")}`);
            }
            await trackBenchShared({ model: benchResult.model, verdict: benchResult.fitness.verdict });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            uploadSpinner.fail(`Upload failed: ${msg}`);
          }
        }
      } catch (err) {
        failedModels.push(modelName);
        if (!silent) {
          errorMsg(`Failed to benchmark ${modelName}`);
          if (err instanceof Error) errorMsg(err.message);
        }
      } finally {
        if (shouldUnloadAfterModel) {
          try {
            await unloadModel(modelName);
          } catch (err) {
            if (!silent) {
              warnMsg(`Could not unload model ${modelName} after benchmark.`);
              if (err instanceof Error) warnMsg(err.message);
            }
          }
        }
      }
    }

    // Summary table if multiple models
    if (!silent && results.length > 1) {
      stepHeader("Summary");
      printSummaryTable(results);
    }

    if (failedModels.length > 0) {
      if (!silent) {
        errorMsg(
          `Benchmark finished with ${failedModels.length} failure(s): ${failedModels.join(", ")}`
        );
      }
      if (shouldSetExitCode) process.exitCode = 1;
    }

    // Share prompt (interactive) for results not yet uploaded (i.e. --share was not passed)
    const canShareResults = !options.perfOnly;
    if (!canShareResults) {
      if (!silent && options.share === true) {
        warnMsg("Sharing is disabled in --perf-only mode. Run a full benchmark to upload results.");
      }
    } else if (!silent && results.length > 0 && options.share !== true && options.share !== false && !options.ciNoMenu) {
      for (const result of results) {
        let decision: "share" | "skip" = "skip";
        try {
          decision = await promptShare(result);
        } catch (err) {
          warnMsg("Could not open share prompt; skipping upload.");
          if (err instanceof Error) {
            warnMsg(err.message);
          }
          decision = "skip";
        }

        if (decision === "share") {
          let uploadPayload: BenchResult = result;
          let submitterEmail: string | undefined;

          try {
            const submitter = await resolveSubmitterForShare();
            if (submitter) {
              uploadPayload = {
                ...result,
                submitter: {
                  nickname: submitter.nickname,
                  emailHash: submitter.emailHash,
                },
              };
              submitterEmail = submitter.email;
            }
          } catch (err) {
            warnMsg("Could not collect benchmark profile; continuing without it.");
            if (err instanceof Error) {
              warnMsg(err.message);
            }
          }

          const uploadSpinner = createSpinner("Uploading result...");
          uploadSpinner.start();
          try {
            const uploaded = await uploadBenchResult(uploadPayload, { submitterEmail });
            uploadSpinner.succeed(`Shared! ${uploaded.url}`);
            if (uploaded.rankGlobalPct != null) {
              const parts: string[] = [`Top ${uploaded.rankGlobalPct}% globally`];
              if (uploaded.rankCpuPct != null) {
                parts.push(`Top ${uploaded.rankCpuPct}% on ${result.hardware.cpu}`);
              }
              successMsg(`  → ${parts.join(" · ")}`);
            }
            await trackBenchShared({ model: result.model, verdict: result.fitness.verdict });
            openUrl(uploaded.url);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            uploadSpinner.fail(`Upload failed: ${msg}`);
          }
        }
      }
    }

    // JSON mode: output results as JSON to stdout
    if (silent) {
      console.log(JSON.stringify(results, null, 2));
    }

    // Flush telemetry (non-blocking)
    await flushTelemetry();

    return { results, failedModels };
  } finally {
    // Avoid leaking keep_alive preferences across separate CLI invocations/tests.
    setRuntimeKeepAlive(undefined);
  }
}
