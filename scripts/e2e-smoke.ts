import chalk from "chalk";
import { benchCommand } from "../src/commands/bench.js";
import { listModels } from "../src/core/ollama-client.js";
import type { PerformanceMetrics } from "../src/types.js";

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isFiniteMetric(value: number): boolean {
  return Number.isFinite(value) && !Number.isNaN(value);
}

function validatePerfMetrics(perf: PerformanceMetrics): string[] {
  const issues: string[] = [];
  if (!isFiniteMetric(perf.tokensPerSecond) || perf.tokensPerSecond < 0) {
    issues.push(`invalid tokensPerSecond: ${perf.tokensPerSecond}`);
  }
  if (!isFiniteMetric(perf.ttft) || perf.ttft < 0) {
    issues.push(`invalid ttft: ${perf.ttft}`);
  }
  if (!isFiniteMetric(perf.loadTime) || perf.loadTime < 0) {
    issues.push(`invalid loadTime: ${perf.loadTime}`);
  }
  if (!isFiniteMetric(perf.memoryUsedGB) || perf.memoryUsedGB < 0) {
    issues.push(`invalid memoryUsedGB: ${perf.memoryUsedGB}`);
  }
  if (!isFiniteMetric(perf.memoryPercent) || perf.memoryPercent < 0 || perf.memoryPercent > 100) {
    issues.push(`invalid memoryPercent: ${perf.memoryPercent}`);
  }
  return issues;
}

function printInfo(message: string): void {
  console.log(chalk.dim(`[smoke] ${message}`));
}

function printSuccess(message: string): void {
  console.log(chalk.green(`[smoke] ${message}`));
}

function printWarn(message: string): void {
  console.log(chalk.yellow(`[smoke] ${message}`));
}

function printError(message: string): void {
  console.error(chalk.red(`[smoke] ${message}`));
}

function handleSkipOrFail(message: string, strict: boolean): never {
  if (strict) {
    printError(message);
    process.exit(1);
  }
  printWarn(`${message} (skipped, set OLLAMA_SMOKE_STRICT=1 to fail)`);
  process.exit(0);
}

async function main(): Promise<void> {
  const strict = envFlag("OLLAMA_SMOKE_STRICT");
  const runFullBench = envFlag("OLLAMA_SMOKE_FULL");
  const preferredModel = process.env.OLLAMA_SMOKE_MODEL?.trim() || "";

  printInfo("Starting Ollama E2E smoke test");

  let models: Awaited<ReturnType<typeof listModels>>;
  try {
    models = await listModels();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    handleSkipOrFail(`Ollama unavailable: ${msg}`, strict);
  }

  if (models.length === 0) {
    handleSkipOrFail("No local models found in Ollama", strict);
  }

  const selectedModel =
    preferredModel.length > 0
      ? models.find((m) => m.name === preferredModel)?.name
      : [...models].sort((a, b) => a.size - b.size)[0]?.name;

  if (!selectedModel) {
    handleSkipOrFail(`Requested model not found: ${preferredModel}`, strict);
  }

  printInfo(`Selected model: ${selectedModel}`);
  printInfo(`Mode: ${runFullBench ? "full benchmark" : "performance-only (default)"}`);

  const outcome = await benchCommand({
    model: selectedModel,
    perfOnly: !runFullBench,
    setExitCode: false,
  });

  if (outcome.failedModels.length > 0 || outcome.results.length !== 1) {
    const details =
      outcome.failedModels.length > 0
        ? `failed models: ${outcome.failedModels.join(", ")}`
        : `unexpected results count: ${outcome.results.length}`;
    handleSkipOrFail(
      `Benchmark execution did not complete cleanly (${details})`,
      strict
    );
  }

  const result = outcome.results[0];
  const issues = validatePerfMetrics(result.performance);
  if (issues.length > 0) {
    printError(`Metric validation failed: ${issues.join(" | ")}`);
    process.exit(1);
  }

  printSuccess(
    `Smoke passed for ${result.model}: ${result.performance.tokensPerSecond.toFixed(1)} tok/s, TTFT ${Math.round(result.performance.ttft)}ms, HW fit ${result.fitness.hardwareFitScore}/100${result.fitness.globalScore !== null ? `, global ${result.fitness.globalScore}/100` : ""}`
  );
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  printError(`Unhandled smoke failure: ${msg}`);
  process.exit(1);
});
