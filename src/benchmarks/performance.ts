import { abortOngoingRequests, generateStream, listRunningModels, getRuntimeName } from "../core/runtime.js";
import { getMemoryUsage, detectThermalPressure, detectBatteryPowered, getSwapUsedGB, getCpuLoad } from "../core/hardware.js";
import type { PerformanceMetrics, BenchEnvironment } from "../types.js";
import { avg, stddev, withTimeout, hasThinkingContent, estimateTokenCount } from "../utils.js";
import { createSpinner, subStep } from "../ui/progress.js";
import { withBenchmarkProfile } from "./profile.js";

const WARMUP_PROMPT = "Say hello in one word.";

const BENCH_PROMPTS = [
  "Explain the concept of recursion in programming in 3 sentences.",
  "What are the main differences between TCP and UDP? Be concise.",
  "Describe how a hash table works in 4 sentences.",
  "Write a detailed step-by-step explanation of how a compiler transforms source code into machine code, covering lexing, parsing, semantic analysis, optimization, and code generation.",
  "Implement a function in pseudocode that checks whether a given string of parentheses, brackets, and braces is balanced. Explain the time and space complexity.",
];

export interface PerformanceBenchResult {
  metrics: PerformanceMetrics;
  thinkingDetected: boolean;
  benchEnvironment?: BenchEnvironment;
}

export interface PerformanceBenchOptions {
  warmupTimeoutMs?: number;
  promptTimeoutMs?: number;
  minSuccessfulPrompts?: number;
  failOnPromptError?: boolean;
  think?: boolean;
  streamStallTimeoutMs?: number;
}

const DEFAULT_WARMUP_TIMEOUT_MS = 300_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;

async function optionalProbe<T>(probe: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await probe();
  } catch {
    return fallback;
  }
}

async function optionalProbeWithAvailability<T>(
  probe: () => Promise<T>,
  fallback: T
): Promise<{ value: T; available: boolean }> {
  try {
    return { value: await probe(), available: true };
  } catch {
    return { value: fallback, available: false };
  }
}

export async function runPerformanceBench(
  model: string,
  options: PerformanceBenchOptions = {}
): Promise<PerformanceBenchResult> {
  const spinner = createSpinner("Warming up model...");
  spinner.start();

  try {
    const warmupTimeoutMs = options.warmupTimeoutMs ?? DEFAULT_WARMUP_TIMEOUT_MS;
    const promptTimeoutMs = options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
    const minSuccessfulPrompts = options.minSuccessfulPrompts ?? Math.max(1, Math.ceil(BENCH_PROMPTS.length / 2));
    const failOnPromptError = options.failOnPromptError ?? false;

    const [memBefore, thermalBefore, swapBeforeResult, batteryPowered] = await Promise.all([
      getMemoryUsage(),
      optionalProbe(() => detectThermalPressure(), "unknown"),
      optionalProbeWithAvailability(() => getSwapUsedGB(), 0),
      optionalProbe(() => detectBatteryPowered(), undefined),
    ]);

    // Capture pre-warmup load state so we can qualify memory footprint reliability
    // when runtimes don't expose per-model loaded size.
    const runningModelsBeforeWarmup = await optionalProbe(() => listRunningModels(), []);
    const modelWasAlreadyLoaded = runningModelsBeforeWarmup.some((m) => m.name === model);

    // Warmup run (also measures load time)
    const warmup = await withTimeout(
      generateStream(model, WARMUP_PROMPT, undefined, {
        ...withBenchmarkProfile({
          num_predict: 32,
          think: options.think,
          stall_timeout_ms: options.streamStallTimeoutMs,
        }),
      }),
      warmupTimeoutMs,
      "Model warmup",
      abortOngoingRequests
    );
    const runtimeName = getRuntimeName();
    const loadTimeAvailable = !(runtimeName === "lm-studio" && warmup.loadDuration === 0);
    const loadTime = warmup.loadDuration / 1e6; // ns -> ms

    // After warmup, query running models for accurate loaded size.
    const runningModels = await listRunningModels();
    const thisModel = runningModels.find((m) => m.name === model);

    spinner.succeed("Model loaded");

    // Run benchmark prompts
    const tpsValues: number[] = [];
    const firstChunkValues: number[] = [];
    const ttftValues: number[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalEvalCount = 0;
    let totalEvalDurationNs = 0;
    let successfulPrompts = 0;
    let failedPrompts = 0;
    let thinkingDetected = false;
    let totalThinkingTokens = 0;
    const cpuLoadSamples: number[] = [];
    let tokensPerSecondEstimated = false;

    for (let i = 0; i < BENCH_PROMPTS.length; i++) {
      spinner.start(`Running performance test ${i + 1}/${BENCH_PROMPTS.length}...`);

      let firstChunkTime: number | null = null;
      let firstTokenTime: number | null = null;
      const startTime = Date.now();

      try {
        const result = await withTimeout(
          generateStream(
            model,
            BENCH_PROMPTS[i],
            {
              onFirstChunk: () => {
                if (firstChunkTime === null) {
                  firstChunkTime = Date.now() - startTime;
                }
              },
              onToken: () => {
                if (firstTokenTime === null) {
                  firstTokenTime = Date.now() - startTime;
                }
              },
            },
            withBenchmarkProfile({
              num_predict: 256,
              think: options.think,
              stall_timeout_ms: options.streamStallTimeoutMs,
            })
          ),
          promptTimeoutMs,
          "Performance benchmark",
          abortOngoingRequests
        );

        // tok/s from runtime-provided generation metrics (evalCount / evalDuration)
        const evalDurationSec = result.evalDuration / 1e9;
        const tps = evalDurationSec > 0 ? result.evalCount / evalDurationSec : 0;
        tpsValues.push(tps);
        totalEvalCount += result.evalCount;
        totalEvalDurationNs += result.evalDuration;
        if (result.evalCountEstimated) {
          tokensPerSecondEstimated = true;
        }

        // First chunk latency / TTFT
        if (firstChunkTime !== null) {
          firstChunkValues.push(firstChunkTime);
        }
        if (firstTokenTime !== null) {
          ttftValues.push(firstTokenTime);
        }

        // Detect thinking content
        if (hasThinkingContent(result.response, result.thinking)) {
          thinkingDetected = true;
          const thinkingText = result.thinking || "";
          totalThinkingTokens += estimateTokenCount(thinkingText);
        }

        totalPromptTokens += result.promptEvalCount;
        totalCompletionTokens += result.evalCount;
        successfulPrompts++;

        subStep(
          `  Prompt ${i + 1}: ${tps.toFixed(1)} tok/s, first chunk ${firstChunkTime ?? "?"}ms, TTFT ${firstTokenTime ?? "?"}ms`
        );

        // Sample CPU load after each prompt
        const cpuSample = await optionalProbe(() => getCpuLoad(), -1);
        if (cpuSample >= 0) cpuLoadSamples.push(cpuSample);
      } catch (err) {
        failedPrompts++;
        const message = err instanceof Error ? err.message : String(err);
        subStep(`  Prompt ${i + 1}: failed (${message})`);
        if (failOnPromptError) {
          throw err;
        }
      }
    }

    if (successfulPrompts < minSuccessfulPrompts) {
      throw new Error(
        `Performance benchmark produced too few successful prompts (${successfulPrompts}/${BENCH_PROMPTS.length}, minimum required: ${minSuccessfulPrompts}).`
      );
    }

    if (failedPrompts > 0) {
      subStep(
        `  Completed with ${failedPrompts} failed prompt(s); metrics use ${successfulPrompts} successful prompt(s).`
      );
    }

    // Measure memory and environment after benchmark (with model loaded)
    const [memAfter, thermalAfter, swapAfterResult] = await Promise.all([
      getMemoryUsage(),
      optionalProbe(() => detectThermalPressure(), thermalBefore),
      optionalProbeWithAvailability(() => getSwapUsedGB(), swapBeforeResult.value),
    ]);

    // Prefer runtime-reported loaded model size when available; otherwise fall back
    // to host memory delta, which reflects actual runtime footprint better than
    // static on-disk model size.
    let memoryUsedGB: number;
    let memoryPercent: number;
    // Only treat runtime-reported running size as a true loaded-memory footprint
    // when the backend exposes a comparable in-memory value. LM Studio's size can
    // reflect local file/directory metadata rather than resident RAM usage.
    const runtimeReportsComparableLoadedSize = runtimeName !== "lm-studio";
    const loadedModelSizeBytes =
      runtimeReportsComparableLoadedSize && thisModel && thisModel.size > 0
        ? thisModel.size
        : 0;
    const memoryFootprintAvailable =
      runtimeReportsComparableLoadedSize
        ? loadedModelSizeBytes > 0 || !modelWasAlreadyLoaded
        : !modelWasAlreadyLoaded;
    if (loadedModelSizeBytes > 0) {
      memoryUsedGB = loadedModelSizeBytes / (1024 ** 3);
      memoryPercent = (memoryUsedGB / memAfter.totalGB) * 100;
    } else {
      memoryUsedGB = Math.max(0, memAfter.usedGB - memBefore.usedGB);
      memoryPercent = Math.max(0, memAfter.percent - memBefore.percent);
    }

    spinner.succeed("Performance benchmark complete");

    // Use a sentinel value for TTFT if no tokens were received
    const firstChunkMs = firstChunkValues.length > 0 ? avg(firstChunkValues) : undefined;
    const ttft = ttftValues.length > 0 ? avg(ttftValues) : -1;

    const swapDeltaGB =
      swapBeforeResult.available && swapAfterResult.available
        ? +(swapAfterResult.value - swapBeforeResult.value).toFixed(2)
        : undefined;
    // CPU load metrics from prompt samples
    const cpuAvgLoad = cpuLoadSamples.length > 0
      ? +(cpuLoadSamples.reduce((a, b) => a + b, 0) / cpuLoadSamples.length).toFixed(1)
      : undefined;
    const cpuPeakLoad = cpuLoadSamples.length > 0
      ? +Math.max(...cpuLoadSamples).toFixed(1)
      : undefined;

    const benchEnvironment: BenchEnvironment = {
      thermalPressureBefore: thermalBefore,
      thermalPressureAfter: thermalAfter,
      ...(swapDeltaGB !== undefined && swapDeltaGB > 0 ? { swapDeltaGB } : {}),
      ...(batteryPowered != null ? { batteryPowered } : {}),
      ...(cpuAvgLoad !== undefined ? { cpuAvgLoad } : {}),
      ...(cpuPeakLoad !== undefined ? { cpuPeakLoad } : {}),
    };

    return {
      metrics: {
        tokensPerSecond:
          totalEvalDurationNs > 0
            ? totalEvalCount / (totalEvalDurationNs / 1e9)
            : avg(tpsValues),
        ...(tokensPerSecondEstimated ? { tokensPerSecondEstimated: true } : {}),
        ...(firstChunkMs !== undefined ? { firstChunkMs } : {}),
        ttft: ttft >= 0 ? ttft : 30_000, // Fallback: 30s if no TTFT measured
        loadTime,
        loadTimeAvailable,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        memoryUsedGB: +memoryUsedGB.toFixed(1),
        memoryPercent: +memoryPercent.toFixed(1),
        memoryFootprintAvailable,
        memoryHostUsedGB: memAfter.usedGB,
        memoryHostPercent: memAfter.percent,
        tpsStdDev: tpsValues.length >= 2 ? stddev(tpsValues) : undefined,
        ...(totalThinkingTokens > 0 ? { thinkingTokensEstimate: totalThinkingTokens } : {}),
      },
      thinkingDetected,
      benchEnvironment,
    };
  } catch (err) {
    if (spinner.isSpinning) {
      spinner.fail("Performance benchmark failed");
    }
    throw err;
  }
}
