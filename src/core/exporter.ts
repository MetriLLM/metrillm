import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BenchResult } from "../types.js";

export type ExportFormat = "json" | "csv" | "md";

function timestampForFilename(value: string): string {
  return value
    .replace(/[:]/g, "-")
    .replace(/[.].+$/, "")
    .replace("T", "_")
    .replace(/[^0-9_-]/g, "");
}

function csvEscape(value: string): string {
  const normalized = value.replace(/\r?\n/g, " ");
  const hardened = /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  if (/[",\n]/.test(hardened)) {
    return `"${hardened.replace(/"/g, "\"\"")}"`;
  }
  return hardened;
}

function markdownEscape(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function toCsv(results: BenchResult[]): string {
  const header = [
    "model",
    "parameter_size",
    "quantization",
    "family",
    "timestamp",
    "tokens_per_second",
    "ttft_ms",
    "model_memory_percent",
    "host_memory_percent",
    "hardware_profile",
    "performance_score",
    "hardware_fit_score",
    "quality_score",
    "global_score",
    "category_labels",
    "verdict",
    "interpretation",
    "disqualifiers",
    "warnings",
  ];

  const rows = results.map((r) =>
    [
      r.model,
      r.modelInfo?.parameterSize ?? "",
      r.modelInfo?.quantization ?? "",
      r.modelInfo?.family ?? "",
      r.timestamp,
      r.performance.tokensPerSecond.toFixed(2),
      r.performance.ttft.toFixed(0),
      r.performance.memoryPercent.toFixed(1),
      r.performance.memoryHostPercent !== undefined
        ? r.performance.memoryHostPercent.toFixed(1)
        : "",
      r.fitness.tuning.profile,
      String(r.fitness.performanceScore.total),
      String(r.fitness.hardwareFitScore),
      r.fitness.qualityScore ? String(r.fitness.qualityScore.total) : "",
      r.fitness.globalScore !== null ? String(r.fitness.globalScore) : "",
      r.fitness.categoryLabels
        ? r.fitness.categoryLabels.map((l) => `${l.category}:${l.level}`).join("; ")
        : "",
      r.fitness.verdict,
      r.fitness.interpretation,
      r.fitness.disqualifiers.join(" | "),
      r.fitness.warnings.join(" | "),
    ]
      .map(csvEscape)
      .join(",")
  );

  return [header.join(","), ...rows].join("\n");
}

function toMarkdown(results: BenchResult[]): string {
  const lines: string[] = [];
  lines.push("# LLMeter Benchmark Results");
  lines.push("");
  const allHaveGlobal = results.every((r) => r.fitness.globalScore !== null);
  lines.push(allHaveGlobal
    ? "_Method: Global = 40% Hardware Fit + 60% Quality. Hardware Fit based on Speed + TTFT + Memory._"
    : "_Method: Hardware Fit is based on Speed + TTFT + Memory. Global is shown only when quality is available._");
  lines.push("");
  lines.push(
    "| Model | Quant | Profile | tok/s | TTFT | Host RAM% | HW Fit | Quality | Global | DQ | Verdict |"
  );
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|");

  for (const r of results) {
    lines.push(
      `| ${markdownEscape(r.model)} | ${markdownEscape(r.modelInfo?.quantization ?? "—")} | ${markdownEscape(r.fitness.tuning.profile)} | ${r.performance.tokensPerSecond.toFixed(
        1
      )} | ${r.performance.ttft.toFixed(0)}ms | ${r.performance.memoryHostPercent !== undefined ? `${r.performance.memoryHostPercent.toFixed(1)}%` : "n/a"} | ${
        r.fitness.hardwareFitScore
      } | ${r.fitness.qualityScore?.total ?? "—"} | ${r.fitness.globalScore ?? "—"} | ${r.fitness.disqualifiers.length} | ${markdownEscape(r.fitness.verdict)} |`
    );
  }

  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  for (const r of results) {
    lines.push(`- **${markdownEscape(r.model)}**: ${markdownEscape(r.fitness.interpretation)}`);
  }

  // Category labels section
  const withLabels = results.filter((r) => r.fitness.categoryLabels);
  if (withLabels.length > 0) {
    lines.push("");
    lines.push("## Category Labels");
    lines.push("");
    for (const r of withLabels) {
      lines.push(`### ${markdownEscape(r.model)}`);
      for (const l of r.fitness.categoryLabels!) {
        lines.push(`- ${markdownEscape(l.category)}: **${markdownEscape(l.level)}** (${l.rawScore.toFixed(0)}%)`);
      }
      lines.push("");
    }
  }

  const withDisqualifiers = results.filter((r) => r.fitness.disqualifiers.length > 0);
  if (withDisqualifiers.length > 0) {
    lines.push("");
    lines.push("## Disqualifiers");
    lines.push("");
    for (const r of withDisqualifiers) {
      lines.push(`### ${markdownEscape(r.model)}`);
      for (const d of r.fitness.disqualifiers) {
        lines.push(`- ${markdownEscape(d)}`);
      }
      lines.push("");
    }
  }

  const withWarnings = results.filter((r) => r.fitness.warnings.length > 0);
  if (withWarnings.length > 0) {
    lines.push("");
    lines.push("## Warnings");
    lines.push("");
    for (const r of withWarnings) {
      lines.push(`### ${markdownEscape(r.model)}`);
      for (const w of r.fitness.warnings) {
        lines.push(`- ${markdownEscape(w)}`);
      }
      lines.push("");
    }
  }

  lines.push("");
  return lines.join("\n");
}

export async function exportBenchResults(
  results: BenchResult[],
  format: ExportFormat,
  outDir = "exports"
): Promise<string> {
  if (results.length === 0) {
    throw new Error("No benchmark results to export.");
  }

  await mkdir(outDir, { recursive: true });

  const ts = timestampForFilename(new Date().toISOString());
  const filename = `llmeter-results-${ts}.${format}`;
  const path = resolve(outDir, filename);

  let content: string;
  if (format === "json") {
    content = JSON.stringify(results, null, 2);
  } else if (format === "csv") {
    content = toCsv(results);
  } else {
    content = toMarkdown(results);
  }

  await writeFile(path, content, "utf8");
  return path;
}
