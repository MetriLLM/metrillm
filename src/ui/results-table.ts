import Table from "cli-table3";
import chalk from "chalk";
import type {
  BenchEnvironment,
  BenchResult,
  HardwareInfo,
  PerformanceMetrics,
  QualityMetrics,
  CategoryLevel,
} from "../types.js";
import { formatDuration } from "../utils.js";
import { scoreColor } from "./score-color.js";
import { effectiveScore, RESPONSE_TIME_LIMITS_MS } from "../scoring/quality-scorer.js";
import { supportsUnicode } from "./terminal.js";

const BAR_FILLED = supportsUnicode ? "\u2588" : "#";
const BAR_EMPTY = supportsUnicode ? "\u2591" : "-";

function compactBar(value: number, max = 100, width = 10): string {
  if (max <= 0) return BAR_EMPTY.repeat(width);
  const ratio = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * width);
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(width - filled);
}

function levelColor(level: CategoryLevel) {
  switch (level) {
    case "Strong": return chalk.green;
    case "Adequate": return chalk.yellow;
    case "Weak": return chalk.hex("#FF8C00");
    case "Poor": return chalk.red;
  }
}

function getLevel(score: number): CategoryLevel {
  if (score >= 75) return "Strong";
  if (score >= 50) return "Adequate";
  if (score >= 25) return "Weak";
  return "Poor";
}

interface CategoryIssueSummary {
  name: string;
  crashes: number;
  timeouts: number;
  errors: number;
}

function summarizeCategoryIssues(name: string, details: QualityMetrics["reasoning"]["details"]): CategoryIssueSummary {
  let crashes = 0;
  let timeouts = 0;
  let errors = 0;

  for (const detail of details) {
    const actual = detail.actual ?? "";
    if (/^TIMEOUT\b/i.test(actual)) {
      timeouts++;
      continue;
    }
    if (/^ERROR:/i.test(actual)) {
      errors++;
      if (/model has crashed|has crashed without additional information|model crashed/i.test(actual)) {
        crashes++;
      }
    }
  }

  return { name, crashes, timeouts, errors };
}

export function printHardwareTable(hw: HardwareInfo): void {
  const table = new Table({
    head: [chalk.bold("Hardware"), chalk.bold("Value")],
    style: { head: [], border: [] },
  });

  const coresDetail =
    hw.cpuPCores !== null && hw.cpuECores !== null
      ? `${hw.cpuCores} (${hw.cpuPCores} performance + ${hw.cpuECores} efficiency)`
      : hw.cpuPCores !== null
        ? `${hw.cpuCores} (${hw.cpuPCores} performance)`
        : hw.cpuECores !== null
          ? `${hw.cpuCores} (${hw.cpuECores} efficiency)`
          : String(hw.cpuCores);

  const cpuLine = hw.cpuFreqGHz
    ? `${hw.cpu} @ ${hw.cpuFreqGHz} GHz`
    : hw.cpu;

  const ramLine = hw.memoryType
    ? `${hw.totalMemoryGB} GB ${hw.memoryType} (${hw.freeMemoryGB} GB free)`
    : `${hw.totalMemoryGB} GB (${hw.freeMemoryGB} GB free)`;

  const swapColor = hw.swapUsedGB > hw.swapTotalGB * 0.5
    ? chalk.yellow
    : chalk.green;
  const swapLine = hw.swapTotalGB > 0
    ? swapColor(`${hw.swapUsedGB} GB / ${hw.swapTotalGB} GB`)
    : "None";

  const gpuLine = hw.gpuCores
    ? `${hw.gpu} (${hw.gpuCores} cores)`
    : hw.gpu;

  const powerModeColor =
    hw.powerMode === "low-power"
      ? chalk.red
      : hw.powerMode === "performance"
        ? chalk.green
        : hw.powerMode === "balanced"
          ? chalk.yellow
          : chalk.dim;
  const powerModeLabel = hw.powerMode ?? "unknown";

  if (hw.machineModel) {
    table.push(["Machine", chalk.bold(hw.machineModel)]);
  }
  table.push(
    ["CPU", cpuLine],
    ["Cores", coresDetail],
    ["RAM", ramLine],
    ["Swap", swapLine],
    ["GPU", gpuLine],
    ["OS", hw.os],
    ["Arch", hw.arch],
    ["Power Mode", powerModeColor(powerModeLabel)]
  );

  if (hw.cpuCurrentSpeedGHz != null) {
    const freqRatio =
      hw.cpuFreqGHz && hw.cpuFreqGHz > 0
        ? ` (${((hw.cpuCurrentSpeedGHz / hw.cpuFreqGHz) * 100).toFixed(0)}% of nominal)`
        : "";
    table.push(["CPU Current Freq", `${hw.cpuCurrentSpeedGHz.toFixed(1)} GHz${freqRatio}`]);
  }

  console.log(table.toString());
}

export function printPerformanceTable(perf: PerformanceMetrics, benchEnvironment?: BenchEnvironment): void {
  const table = new Table({
    head: [chalk.bold("Metric"), chalk.bold("Value")],
    style: { head: [], border: [] },
  });

  const tpsColor =
    perf.tokensPerSecond >= 30
      ? chalk.green
      : perf.tokensPerSecond >= 15
        ? chalk.yellow
        : chalk.red;

  const ttftColor =
    perf.ttft < 1000
      ? chalk.green
      : perf.ttft < 3000
        ? chalk.yellow
        : chalk.red;

  const memColor =
    perf.memoryPercent < 50
      ? chalk.green
      : perf.memoryPercent < 80
        ? chalk.yellow
        : chalk.red;

  table.push(
    ["Tokens/sec", tpsColor(`${perf.tokensPerSecond.toFixed(1)} tok/s`)],
    [
      "First Chunk Latency",
      perf.firstChunkMs !== undefined
        ? formatDuration(perf.firstChunkMs)
        : chalk.dim("N/A (stream metric unavailable)"),
    ],
    ["Time to First Token", ttftColor(formatDuration(perf.ttft))],
    [
      "Model Load Time",
      perf.loadTimeAvailable === false
        ? chalk.dim("N/A (runtime metric unavailable)")
        : formatDuration(perf.loadTime),
    ],
    ["Total Tokens", String(perf.totalTokens)],
    ["Prompt Tokens", String(perf.promptTokens)],
    ["Completion Tokens", String(perf.completionTokens)],
    [
      "Model Memory Footprint",
      memColor(
        `${perf.memoryUsedGB.toFixed(1)} GB (+${perf.memoryPercent.toFixed(0)}%)`
      ),
    ],
    [
      "Host RAM Pressure",
      perf.memoryHostPercent !== undefined && perf.memoryHostUsedGB !== undefined
        ? `${perf.memoryHostUsedGB.toFixed(1)} GB (${perf.memoryHostPercent.toFixed(0)}%)`
        : chalk.dim("N/A (host metric unavailable)"),
    ],
  );

  if (perf.thinkingTokensEstimate && perf.thinkingTokensEstimate > 0) {
    table.push([
      chalk.magenta("Thinking Tokens (est.)"),
      chalk.magenta(`~${perf.thinkingTokensEstimate} tokens`),
    ]);
  }

  if (benchEnvironment?.cpuAvgLoad != null && benchEnvironment.cpuAvgLoad >= 0) {
    const cpuColor = benchEnvironment.cpuAvgLoad < 50 ? chalk.green
      : benchEnvironment.cpuAvgLoad < 80 ? chalk.yellow
      : chalk.red;
    table.push([
      "CPU Load During Bench",
      cpuColor(`avg ${benchEnvironment.cpuAvgLoad.toFixed(0)}%` +
        (benchEnvironment.cpuPeakLoad != null ? ` (peak ${benchEnvironment.cpuPeakLoad.toFixed(0)}%)` : "")),
    ]);
  }

  console.log(table.toString());
}

export function printQualityTable(quality: QualityMetrics, timePenalties?: Record<string, number>): void {
  console.log(
    chalk.dim(
      "Quality scores are based on an internal mixed-difficulty dataset; interpret as directional, not absolute."
    )
  );

  const table = new Table({
    head: [
      chalk.bold("Category"),
      chalk.bold("Score"),
      chalk.bold("Accuracy"),
      chalk.bold("Level"),
    ],
    style: { head: [], border: [] },
  });

  const categories: { name: string; key: string; result: typeof quality.reasoning; label: string }[] = [
    { name: "Reasoning", key: "reasoning", result: quality.reasoning, label: "questions" },
    { name: "Coding", key: "coding", result: quality.coding, label: "tasks" },
    { name: "Instruction Following", key: "instructionFollowing", result: quality.instructionFollowing, label: "tasks" },
    { name: "Structured Output", key: "structuredOutput", result: quality.structuredOutput, label: "tasks" },
    { name: "Math", key: "math", result: quality.math, label: "problems" },
    { name: "Multilingual", key: "multilingual", result: quality.multilingual, label: "questions" },
  ];

  for (const cat of categories) {
    const effective = effectiveScore(cat.result, RESPONSE_TIME_LIMITS_MS[cat.key]);
    const raw = cat.result.score;
    const level = getLevel(effective);
    const penaltyCount = timePenalties?.[cat.key] ?? 0;
    const accuracyText = penaltyCount > 0
      ? `${cat.result.correct}/${cat.result.total} ${cat.label} ${chalk.yellow(`(${penaltyCount} slow)`)}`
      : `${cat.result.correct}/${cat.result.total} ${cat.label}`;
    const scoreText = Math.round(effective) !== Math.round(raw)
      ? `${effective.toFixed(0)}% ${chalk.dim(`(raw ${raw.toFixed(0)}%)`)}`
      : `${effective.toFixed(0)}%`;
    table.push([
      cat.name,
      scoreColor(effective)(scoreText),
      accuracyText,
      levelColor(level)(level),
    ]);
  }
  console.log(table.toString());

  const issueSummaries = categories
    .map((cat) => summarizeCategoryIssues(cat.name, cat.result.details))
    .filter((summary) => summary.errors > 0 || summary.timeouts > 0);

  if (issueSummaries.length > 0) {
    console.log(chalk.yellow("Execution issues detected during quality benchmark:"));
    for (const summary of issueSummaries) {
      const parts: string[] = [];
      if (summary.crashes > 0) parts.push(`${summary.crashes} crash${summary.crashes > 1 ? "es" : ""}`);
      const nonCrashErrors = summary.errors - summary.crashes;
      if (nonCrashErrors > 0) parts.push(`${nonCrashErrors} error${nonCrashErrors > 1 ? "s" : ""}`);
      if (summary.timeouts > 0) parts.push(`${summary.timeouts} timeout${summary.timeouts > 1 ? "s" : ""}`);
      console.log(chalk.yellow(`  • ${summary.name}: ${parts.join(", ")} (scored as incorrect)`));
    }
  }
}

export function printSummaryTable(results: BenchResult[]): void {
  const termWidth = process.stdout.columns || 80;
  const compact = termWidth < 100;

  console.log(
    chalk.dim(
      "Global = 30% Hardware Fit + 70% Quality. Hardware Fit = host compatibility. Quality = model capability."
    )
  );

  const head = [
    chalk.bold("Model"),
    chalk.bold("tok/s"),
    chalk.bold("TTFT"),
    chalk.bold("Host RAM%"),
    chalk.bold("Profile"),
    chalk.bold("HW Fit"),
    chalk.bold("Quality"),
    chalk.bold("Global"),
    ...(compact ? [] : [chalk.bold("DQ"), chalk.bold("Flags")]),
    chalk.bold("Verdict"),
  ];

  const table = new Table({
    head,
    style: { head: [], border: [] },
    wordWrap: true,
  });

  for (const r of results) {
    const vColor =
      r.fitness.verdict === "EXCELLENT"
        ? chalk.green.bold
        : r.fitness.verdict === "GOOD"
          ? chalk.blue.bold
          : r.fitness.verdict === "MARGINAL"
            ? chalk.yellow.bold
            : chalk.red.bold;

    const flags: string[] = [];
    if (r.hardware.powerMode === "low-power") flags.push(chalk.red("ECO"));
    if (r.modelInfo?.thinkingDetected) flags.push(chalk.magenta("THINK"));

    const modelName = compact && r.model.length > 20
      ? r.model.slice(0, 18) + ".."
      : r.model;

    const row = [
      modelName,
      `${r.performance.tokensPerSecond.toFixed(1)}`,
      formatDuration(r.performance.ttft),
      r.performance.memoryHostPercent !== undefined
        ? `${r.performance.memoryHostPercent.toFixed(0)}%`
        : "n/a",
      r.fitness.tuning.profile,
      scoreColor(r.fitness.hardwareFitScore)(
        `${compactBar(r.fitness.hardwareFitScore)} ${r.fitness.hardwareFitScore}%`
      ),
      r.fitness.qualityScore
        ? scoreColor(r.fitness.qualityScore.total)(
            `${compactBar(r.fitness.qualityScore.total)} ${r.fitness.qualityScore.total}%`
          )
        : "\u2014",
      r.fitness.globalScore !== null
        ? scoreColor(r.fitness.globalScore)(
            `${compactBar(r.fitness.globalScore)} ${r.fitness.globalScore}%`
          )
        : "\u2014",
      ...(compact
        ? []
        : [
            String(r.fitness.disqualifiers.length),
            flags.length > 0 ? flags.join(" ") : "\u2014",
          ]),
      vColor(r.fitness.verdict),
    ];

    table.push(row);
  }
  console.log(table.toString());
}
