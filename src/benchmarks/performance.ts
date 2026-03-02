import { abortOngoingRequests, generateStream, listRunningModels } from "../core/runtime.js";
import { getMemoryUsage } from "../core/hardware.js";
import type { PerformanceMetrics } from "../types.js";
import { avg, stddev, withTimeout, hasThinkingContent, estimateTokenCount } from "../utils.js";
import { createSpinner, subStep } from "../ui/progress.js";

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
}

export interface PerformanceBenchOptions {
  warmupTimeoutMs?: number;
  promptTimeoutMs?: number;
  minSuccessfulPrompts?: number;
  failOnPromptError?: boolean;
  think?: boolean;
}

const DEFAULT_WARMUP_TIMEOUT_MS = 120_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 60_000;

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

    const memBefore = await getMemoryUsage();

    // Warmup run (also measures load time)
    const warmup = await withTimeout(
      generateStream(model, WARMUP_PROMPT, undefined, {
        num_predict: 32,
        think: options.think,
      }),
      warmupTimeoutMs,
      "Model warmup",
      abortOngoingRequests
    );
    const loadTime = warmup.loadDuration / 1e6; // ns -> ms

    // After warmup, query ollama ps for accurate model memory size
    const runningModels = await listRunningModels();
    const thisModel = runningModels.find((m) => m.name === model);

    spinner.succeed("Model loaded");

    // Run benchmark prompts
    const tpsValues: number[] = [];
    const ttftValues: number[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalEvalCount = 0;
    let totalEvalDurationNs = 0;
    let successfulPrompts = 0;
    let failedPrompts = 0;
    let thinkingDetected = false;
    let totalThinkingTokens = 0;

    for (let i = 0; i < BENCH_PROMPTS.length; i++) {
      spinner.start(`Running performance test ${i + 1}/${BENCH_PROMPTS.length}...`);

      let firstTokenTime: number | null = null;
      const startTime = Date.now();

      try {
        const result = await withTimeout(
          generateStream(
            model,
            BENCH_PROMPTS[i],
            {
              onToken: () => {
                if (firstTokenTime === null) {
                  firstTokenTime = Date.now() - startTime;
                }
              },
            },
            { num_predict: 256, think: options.think }
          ),
          promptTimeoutMs,
          "Performance benchmark",
          abortOngoingRequests
        );

        // tok/s from Ollama's own measurement
        const evalDurationSec = result.evalDuration / 1e9;
        const tps = evalDurationSec > 0 ? result.evalCount / evalDurationSec : 0;
        tpsValues.push(tps);
        totalEvalCount += result.evalCount;
        totalEvalDurationNs += result.evalDuration;

        // TTFT
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
          `  Prompt ${i + 1}: ${tps.toFixed(1)} tok/s, TTFT ${firstTokenTime ?? "?"}ms`
        );
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

    // Measure memory after benchmark (with model loaded)
    const memAfter = await getMemoryUsage();

    // Prefer Ollama's reported model size (accurate), fall back to system delta
    let memoryUsedGB: number;
    let memoryPercent: number;
    if (thisModel && thisModel.size > 0) {
      memoryUsedGB = thisModel.size / (1024 ** 3);
      memoryPercent = (memoryUsedGB / memAfter.totalGB) * 100;
    } else {
      memoryUsedGB = Math.max(0, memAfter.usedGB - memBefore.usedGB);
      memoryPercent = Math.max(0, memAfter.percent - memBefore.percent);
    }

    spinner.succeed("Performance benchmark complete");

    // Use a sentinel value for TTFT if no tokens were received
    const ttft = ttftValues.length > 0 ? avg(ttftValues) : -1;

    return {
      metrics: {
        tokensPerSecond:
          totalEvalDurationNs > 0
            ? totalEvalCount / (totalEvalDurationNs / 1e9)
            : avg(tpsValues),
        ttft: ttft >= 0 ? ttft : 30_000, // Fallback: 30s if no TTFT measured
        loadTime,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        memoryUsedGB: +memoryUsedGB.toFixed(1),
        memoryPercent: +memoryPercent.toFixed(1),
        memoryHostUsedGB: memAfter.usedGB,
        memoryHostPercent: memAfter.percent,
        tpsStdDev: tpsValues.length >= 2 ? stddev(tpsValues) : undefined,
        ...(totalThinkingTokens > 0 ? { thinkingTokensEstimate: totalThinkingTokens } : {}),
      },
      thinkingDetected,
    };
  } catch (err) {
    if (spinner.isSpinning) {
      spinner.fail("Performance benchmark failed");
    }
    throw err;
  }
}
