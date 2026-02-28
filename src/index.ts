import { Command } from "commander";
import { printBanner } from "./ui/banner.js";
import { benchCommand } from "./commands/bench.js";
import { listCommand } from "./commands/list.js";
import { runInteractiveMenu } from "./ui/menu.js";
import { exportBenchResults, type ExportFormat } from "./core/exporter.js";
import { errorMsg, successMsg } from "./ui/progress.js";

// Graceful shutdown on Ctrl+C
process.on("SIGINT", () => {
  // Show cursor (ora hides it) and exit cleanly
  if (process.stdout.isTTY) {
    process.stdout.write("\x1B[?25h");
  }
  console.log("\n\nInterrupted by user.");
  process.exit(130);
});

const program = new Command();

function parsePositiveIntegerOption(value: unknown, optionName: string): number | null {
  const raw = String(value).trim();
  if (!/^[1-9]\d*$/.test(raw)) {
    errorMsg(`Invalid ${optionName} value: ${value}. Expected a positive integer.`);
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    errorMsg(`Invalid ${optionName} value: ${value}. Expected a safe positive integer.`);
    return null;
  }
  return parsed;
}

function hasCiNoMenuFlag(argv: string[]): boolean {
  return argv.includes("--ci-no-menu");
}

function shouldShortCircuitCiNoMenu(argv: string[]): boolean {
  // Only short-circuit on the exact root invocation:
  // `llmeter --ci-no-menu`
  // Any additional argument should still be parsed by commander
  // so unknown flags/subcommands fail fast.
  return argv.length === 1 && argv[0] === "--ci-no-menu";
}

program
  .name("llmeter")
  .description(
    "Benchmark local LLMs for hardware fit and task quality, then compute a global verdict"
  )
  .version("0.1.0")
  .hook("preAction", () => {
    printBanner();
  });

program.option(
  "--ci-no-menu",
  "Do not open interactive menu when no subcommand is provided (for CI automation)"
);

program
  .command("bench")
  .description("Run benchmarks on local LLM models")
  .option("-m, --model <name>", "Specific model to benchmark")
  .option("--perf-only", "Run hardware/performance benchmarks only (skip quality tasks)")
  .option("--perf-warmup-timeout-ms <ms>", "Warmup timeout in milliseconds (default: 120000)")
  .option("--perf-prompt-timeout-ms <ms>", "Per-prompt timeout in milliseconds (default: 60000)")
  .option("--perf-min-successful-prompts <count>", "Minimum successful perf prompts required (default: 3)")
  .option("--perf-strict", "Fail immediately if any performance prompt fails")
  .option("--share", "Share results on the public leaderboard (no prompt)")
  .option("--no-share", "Skip the share prompt entirely")
  .option("--export <format>", "Export results: json | csv | md")
  .option("--out <dir>", "Export output directory (default: exports)")
  .action(async (opts) => {
    let exportFormat: ExportFormat | null = null;
    if (opts.export) {
      const fmt = String(opts.export).toLowerCase();
      if (fmt !== "json" && fmt !== "csv" && fmt !== "md") {
        errorMsg("Invalid --export format. Use one of: json, csv, md");
        process.exitCode = 1;
        return;
      }
      exportFormat = fmt as ExportFormat;
    }

    const perfWarmupTimeoutMs =
      opts.perfWarmupTimeoutMs !== undefined
        ? parsePositiveIntegerOption(opts.perfWarmupTimeoutMs, "--perf-warmup-timeout-ms")
        : undefined;
    if (opts.perfWarmupTimeoutMs !== undefined && perfWarmupTimeoutMs === null) {
      process.exitCode = 1;
      return;
    }

    const perfPromptTimeoutMs =
      opts.perfPromptTimeoutMs !== undefined
        ? parsePositiveIntegerOption(opts.perfPromptTimeoutMs, "--perf-prompt-timeout-ms")
        : undefined;
    if (opts.perfPromptTimeoutMs !== undefined && perfPromptTimeoutMs === null) {
      process.exitCode = 1;
      return;
    }

    const perfMinSuccessfulPrompts =
      opts.perfMinSuccessfulPrompts !== undefined
        ? parsePositiveIntegerOption(opts.perfMinSuccessfulPrompts, "--perf-min-successful-prompts")
        : undefined;
    if (opts.perfMinSuccessfulPrompts !== undefined && perfMinSuccessfulPrompts === null) {
      process.exitCode = 1;
      return;
    }

    const shareOption =
      typeof opts.share === "boolean"
        ? opts.share
        : undefined;

    const outcome = await benchCommand({
      model: opts.model,
      perfOnly: opts.perfOnly,
      perfWarmupTimeoutMs: perfWarmupTimeoutMs ?? undefined,
      perfPromptTimeoutMs: perfPromptTimeoutMs ?? undefined,
      perfMinSuccessfulPrompts: perfMinSuccessfulPrompts ?? undefined,
      perfStrict: Boolean(opts.perfStrict),
      share: shareOption,
      ciNoMenu: hasCiNoMenuFlag(process.argv.slice(2)),
    });

    if (exportFormat) {
      if (outcome.results.length === 0) {
        errorMsg("No benchmark results to export.");
        process.exitCode = 1;
        return;
      }

      try {
        const path = await exportBenchResults(
          outcome.results,
          exportFormat,
          opts.out
        );
        successMsg(`Results exported: ${path}`);
      } catch (err) {
        errorMsg("Failed to export benchmark results.");
        if (err instanceof Error) errorMsg(err.message);
        process.exitCode = 1;
      }
    }
  });

program
  .command("list")
  .description("List available Ollama models")
  .action(async () => {
    await listCommand();
  });

program
  .command("menu")
  .description("Open interactive menu")
  .action(async () => {
    await runInteractiveMenu();
  });

const argv = process.argv.slice(2);
if (shouldShortCircuitCiNoMenu(argv)) {
  printBanner();
  successMsg("CI non-interactive mode: no menu opened.");
} else if (argv.length === 0) {
  printBanner();
  await runInteractiveMenu();
} else {
  await program.parseAsync();
}
