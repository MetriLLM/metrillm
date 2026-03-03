import chalk from "chalk";
import type { FitnessResult } from "../types.js";
import { scoreColor, type ColorFn } from "./score-color.js";
import { supportsUnicode } from "./terminal.js";

const BOX_INNER = 60;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

// Strip ANSI escape codes to get visible string length
function visibleLength(str: string): number {
  return str.replace(ANSI_RE, "").length;
}

function wrapText(text: string, maxWidth: number): string[] {
  if (visibleLength(text) <= maxWidth) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (visibleLength(current) === 0) {
      current = word;
    } else if (visibleLength(current) + 1 + visibleLength(word) <= maxWidth) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

const BAR_FILLED = supportsUnicode ? "\u2588" : "#";
const BAR_EMPTY = supportsUnicode ? "\u2591" : "-";

function progressBar(value: number, max: number, width = 26): string {
  if (max <= 0) return BAR_EMPTY.repeat(width);
  const ratio = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(empty);
}

function levelColor(level: string): ColorFn {
  switch (level) {
    case "Strong": return chalk.green;
    case "Adequate": return chalk.yellow;
    case "Weak": return chalk.hex("#FF8C00"); // orange
    case "Poor": return chalk.red;
    default: return chalk.dim;
  }
}

const BOX_TL = supportsUnicode ? "\u250C" : "+";
const BOX_TR = supportsUnicode ? "\u2510" : "+";
const BOX_BL = supportsUnicode ? "\u2514" : "+";
const BOX_BR = supportsUnicode ? "\u2518" : "+";
const BOX_H = supportsUnicode ? "\u2500" : "-";
const BOX_V = supportsUnicode ? "\u2502" : "|";

function sectionStart(title: string, borderColor: ColorFn): void {
  const pad = Math.max(1, BOX_INNER - title.length);
  console.log(borderColor(`${BOX_TL} ${title} ${BOX_H.repeat(pad)}${BOX_TR}`));
}

function sectionEnd(borderColor: ColorFn): void {
  console.log(borderColor(`${BOX_BL}${BOX_H.repeat(BOX_INNER + 2)}${BOX_BR}`));
}

function sectionText(
  text: string,
  borderColor: ColorFn,
  textColor: ColorFn = chalk.dim
): void {
  const contentWidth = BOX_INNER;
  const lines = text.length === 0 ? [""] : wrapText(text, contentWidth);
  for (const line of lines) {
    const pad = Math.max(0, contentWidth - visibleLength(line));
    console.log(`${borderColor(BOX_V)} ${textColor(line)}${" ".repeat(pad)} ${borderColor(BOX_V)}`);
  }
}

function scoreRow(
  label: string,
  score: number,
  borderColor: ColorFn,
  max = 100
): void {
  const color = scoreColor(score);
  const meter = progressBar(score, max);
  const content = `${label.padEnd(16)} ${color(`[${meter}] ${score.toFixed(0)}/${max}`)}`;
  const visible = visibleLength(content);
  const pad = Math.max(0, BOX_INNER - visible);
  console.log(
    `${borderColor(BOX_V)} ${content}${" ".repeat(pad)} ${borderColor(BOX_V)}`
  );
}

function verdictIcon(verdict: string): string {
  if (supportsUnicode) {
    switch (verdict) {
      case "EXCELLENT": return "\u25A0";
      case "GOOD": return "\u25CF";
      case "MARGINAL": return "\u25B2";
      default: return "\u2717";
    }
  }
  switch (verdict) {
    case "EXCELLENT": return "*";
    case "GOOD": return "o";
    case "MARGINAL": return "!";
    default: return "x";
  }
}

function verdictColor(verdict: string): ColorFn {
  switch (verdict) {
    case "EXCELLENT": return chalk.green.bold;
    case "GOOD": return chalk.blue.bold;
    case "MARGINAL": return chalk.yellow.bold;
    default: return chalk.red.bold;
  }
}

export function printVerdict(model: string, fitness: FitnessResult): void {
  console.log(chalk.bold("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(chalk.bold(`  VERDICT for ${model}`));
  console.log(chalk.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

  const fitBorder = chalk.cyan;
  const qualityBorder = chalk.green;
  const globalBorder = chalk.magenta;

  // ── Section A: Hardware Fit ──
  sectionStart("A) Hardware Fit", fitBorder);
  sectionText(
    "Method: thresholds are adjusted to your host hardware profile.",
    fitBorder,
    chalk.white
  );
  sectionText(`Active profile: ${fitness.tuning.profile}`, fitBorder, chalk.white);
  sectionText(
    "Formula: Speed (/50) + TTFT (/20) + Memory (/30) = Hardware Fit (/100).",
    fitBorder
  );
  sectionText(
    `Targets speed (tok/s): Excellent >= ${fitness.tuning.speed.excellent}, Good >= ${fitness.tuning.speed.good}, Marginal >= ${fitness.tuning.speed.marginal}`,
    fitBorder
  );
  sectionText(
    `Targets TTFT (ms): Excellent <= ${fitness.tuning.ttft.excellentMs}, Good <= ${fitness.tuning.ttft.goodMs}, Marginal <= ${fitness.tuning.ttft.marginalMs}`,
    fitBorder
  );
  sectionText(
    `Hard limits: speed >= ${fitness.tuning.speed.hardMin} tok/s, TTFT <= ${fitness.tuning.ttft.hardMaxMs}ms, load <= ${fitness.tuning.loadTimeHardMaxMs}ms`,
    fitBorder
  );
  sectionText("", fitBorder);
  scoreRow("Performance", fitness.performanceScore.total, fitBorder);
  sectionText(
    `  Breakdown: Speed ${fitness.performanceScore.speed}/50  TTFT ${fitness.performanceScore.ttft}/20  Memory ${fitness.performanceScore.memory}/30`,
    fitBorder
  );
  scoreRow("Hardware Fit", fitness.hardwareFitScore, fitBorder);

  if (fitness.disqualifiers.length > 0) {
    sectionText("Disqualifiers:", fitBorder, chalk.red);
    for (const d of fitness.disqualifiers) {
      sectionText(`  • ${d}`, fitBorder, chalk.red);
    }
  }
  if (fitness.warnings.length > 0) {
    sectionText("Warnings:", fitBorder, chalk.yellow);
    for (const w of fitness.warnings) {
      sectionText(`  ${supportsUnicode ? "\u26A0" : "!!"} ${w}`, fitBorder, chalk.yellow);
    }
  }
  sectionEnd(fitBorder);

  // ── Section B: Task Quality ──
  sectionStart("B) Task Quality", qualityBorder);
  if (fitness.qualityScore && fitness.categoryLabels) {
    sectionText(
      "Quality assessment based on 6 dimensions across diverse task types.",
      qualityBorder,
      chalk.white
    );
    sectionText("", qualityBorder);
    scoreRow("Quality Total", fitness.qualityScore.total, qualityBorder);
    sectionText("", qualityBorder);

    for (const label of fitness.categoryLabels) {
      const color = levelColor(label.level);
      sectionText(
        `  ${label.category.padEnd(24)} ${color(`${label.rawScore.toFixed(0)}%`.padEnd(6))} ${color(label.level)}`,
        qualityBorder,
        chalk.white
      );
    }

    // Time penalty summary
    if (fitness.qualityScore.timePenalties) {
      const parts: string[] = [];
      const limitLabels: Record<string, string> = {
        reasoning: "reasoning",
        math: "math",
        coding: "coding",
        instructionFollowing: "instruction-following",
        structuredOutput: "structured-output",
        multilingual: "multilingual",
      };
      for (const [key, count] of Object.entries(fitness.qualityScore.timePenalties)) {
        parts.push(`${count} ${limitLabels[key] ?? key}`);
      }
      sectionText("", qualityBorder);
      sectionText(
        `Time penalties: ${parts.join(" + ")} answers penalized (response too slow)`,
        qualityBorder,
        chalk.yellow
      );
    }

    sectionText("", qualityBorder);
    sectionText(
      "Based on an internal mixed-difficulty dataset; interpret as directional, not absolute.",
      qualityBorder
    );
  } else {
    sectionText("", qualityBorder);
    sectionText("Quality not computed (performance-only run).", qualityBorder);
    sectionText("Run a full benchmark to get quality assessment.", qualityBorder);
  }
  sectionEnd(qualityBorder);

  // ── Section C: Global Score ──
  sectionStart("C) Global Score", globalBorder);
  if (fitness.globalScore !== null) {
    sectionText(
      "Formula: Global = 30% Hardware Fit + 70% Quality.",
      globalBorder,
      chalk.white
    );
    sectionText("", globalBorder);
    scoreRow("Global Score", fitness.globalScore, globalBorder);
  } else {
    sectionText("", globalBorder);
    sectionText("Global score unavailable (performance-only run).", globalBorder);
  }

  const vColor = verdictColor(fitness.verdict);
  const icon = verdictIcon(fitness.verdict);
  sectionText("", globalBorder);
  sectionText(`Verdict: ${icon} ${fitness.verdict}`, globalBorder, vColor);
  sectionText(`Interpretation: ${fitness.interpretation}`, globalBorder);
  sectionEnd(globalBorder);

  console.log(chalk.bold("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
}
