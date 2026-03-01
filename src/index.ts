if (process.env.NO_COLOR !== undefined) {
  process.env.FORCE_COLOR = "0";
}

import { Command } from "commander";
import { printBanner } from "./ui/banner.js";
import { benchCommand } from "./commands/bench.js";
import { listCommand } from "./commands/list.js";
import { runInteractiveMenu } from "./ui/menu.js";
import { exportBenchResults, type ExportFormat } from "./core/exporter.js";
import { errorMsg, successMsg } from "./ui/progress.js";
import { canUseInteractiveMenu } from "./cli-interactive.js";
import { printGuruMeditationSync } from "./ui/guru-meditation.js";

// Restore cursor on any exit (covers normal exit, unhandled errors, etc.)
process.on("exit", () => {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1B[?25h");
  }
});

// Graceful shutdown on Ctrl+C
process.on("SIGINT", () => {
  printGuruMeditationSync();
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

function parseKeepAliveOption(value: unknown): string | number | null {
  const raw = String(value).trim();
  if (raw.length === 0) {
    errorMsg("Invalid --keep-alive value: expected a duration string (e.g. 2m) or seconds.");
    return null;
  }
  if (/^\d+$/.test(raw)) {
    const seconds = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      errorMsg(`Invalid --keep-alive value: ${value}.`);
      return null;
    }
    return seconds;
  }
  return raw;
}

function parseUnloadAfterBenchOverride(argv: string[]): boolean | undefined {
  if (argv.includes("--unload-after-bench")) return true;
  if (argv.includes("--no-unload-after-bench")) return false;
  return undefined;
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
  .hook("preAction", (_thisCommand, actionCommand) => {
    // Skip banner in JSON mode
    if (!actionCommand.opts()?.json) printBanner();
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
  .option("--share", "Share results on the public leaderboard (skip confirmation)")
  .option("--no-share", "Skip the share prompt entirely")
  .option("--keep-alive <duration>", "Ollama keep_alive value (seconds or duration string, e.g. 2m)")
  .option("--unload-after-bench", "Unload model(s) after benchmark completion")
  .option("--no-unload-after-bench", "Do not unload model(s) after benchmark completion")
  .option("--json", "Output results as JSON to stdout (no UI)")
  .option("--export <format>", "Export results: json | csv | md")
  .option("--out <dir>", "Export output directory (default: exports)")
  .option("--telemetry", "Enable anonymous usage stats")
  .option("--no-telemetry", "Disable anonymous usage stats")
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
    const unloadAfterBench = parseUnloadAfterBenchOverride(process.argv.slice(2));

    const keepAlive =
      opts.keepAlive !== undefined
        ? parseKeepAliveOption(opts.keepAlive)
        : undefined;
    if (opts.keepAlive !== undefined && keepAlive === null) {
      process.exitCode = 1;
      return;
    }

    // Handle telemetry opt-in/out persistence
    if (typeof opts.telemetry === "boolean") {
      const { saveTelemetryConsent } = await import("./core/telemetry.js");
      await saveTelemetryConsent(opts.telemetry);
    }

    const outcome = await benchCommand({
      model: opts.model,
      perfOnly: opts.perfOnly,
      perfWarmupTimeoutMs: perfWarmupTimeoutMs ?? undefined,
      perfPromptTimeoutMs: perfPromptTimeoutMs ?? undefined,
      perfMinSuccessfulPrompts: perfMinSuccessfulPrompts ?? undefined,
      perfStrict: Boolean(opts.perfStrict),
      share: shareOption,
      ciNoMenu: hasCiNoMenuFlag(process.argv.slice(2)),
      json: Boolean(opts.json),
      keepAlive: keepAlive ?? undefined,
      unloadAfterBench,
    });

    if (exportFormat && !opts.json) {
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
  if (!canUseInteractiveMenu(process.stdin.isTTY, process.stdout.isTTY)) {
    errorMsg("No interactive terminal detected. Use `llmeter --ci-no-menu` or a subcommand.");
    process.exitCode = 1;
  } else {
    await runInteractiveMenu();
  }
} else {
  await program.parseAsync();
}
