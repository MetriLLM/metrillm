import { Command } from "commander";
import { execSync } from "node:child_process";
import { printBanner } from "./ui/banner.js";
import { benchCommand } from "./commands/bench.js";
import { listCommand } from "./commands/list.js";
import { runInteractiveMenu } from "./ui/menu.js";
import { exportBenchResults, type ExportFormat } from "./core/exporter.js";
import { errorMsg, successMsg, warnMsg } from "./ui/progress.js";
import { normalizeRuntimeBackend } from "./core/runtime.js";
import { canUseInteractiveMenu } from "./cli-interactive.js";
import { printGuruMeditationSync } from "./ui/guru-meditation.js";
import { checkForUpdate, type UpdateInfo } from "./core/update-checker.js";

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

function checkWindowsExecutionPolicy(): void {
  if (process.platform !== "win32") return;
  try {
    const policy = execSync("powershell -NoProfile -Command Get-ExecutionPolicy", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (policy === "Restricted" || policy === "AllSigned") {
      warnMsg(
        `PowerShell execution policy is "${policy}" — "npm install -g metrillm" won't work in PowerShell.`
      );
      warnMsg(
        "Fix: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned"
      );
      warnMsg(
        "Or keep using: npx metrillm (works without changing the policy)"
      );
    }
  } catch {
    // Not on PowerShell or command failed — skip silently.
  }
}

checkWindowsExecutionPolicy();

const CLI_VERSION = "0.2.2";

// Fire-and-forget update check (skipped for non-interactive / output-sensitive flags).
const skipUpdateCheckFlags = ["--json", "--ci-no-menu", "--help", "--version", "-h", "-V"];
const shouldCheckUpdate = !process.argv.slice(2).some((a) => skipUpdateCheckFlags.includes(a));
const updateCheckPromise: Promise<UpdateInfo | null> = shouldCheckUpdate
  ? checkForUpdate(CLI_VERSION).catch(() => null)
  : Promise.resolve(null);

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

function parseNonNegativeIntegerOption(value: unknown, optionName: string): number | null {
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    errorMsg(`Invalid ${optionName} value: ${value}. Expected a non-negative integer.`);
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    errorMsg(`Invalid ${optionName} value: ${value}. Expected a safe non-negative integer.`);
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

function parseBackendOption(value: unknown): string | null {
  try {
    return normalizeRuntimeBackend(String(value ?? ""));
  } catch (err) {
    errorMsg(err instanceof Error ? err.message : "Invalid --backend value.");
    return null;
  }
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
  // `metrillm --ci-no-menu`
  // Any additional argument should still be parsed by commander
  // so unknown flags/subcommands fail fast.
  return argv.length === 1 && argv[0] === "--ci-no-menu";
}

program
  .name("metrillm")
  .description(
    "Benchmark local LLMs for hardware fit and task quality, then compute a global verdict"
  )
  .version(CLI_VERSION)
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
  .option("--backend <name>", "Inference backend: ollama | lm-studio")
  .option("--perf-only", "Run hardware/performance benchmarks only (skip quality tasks)")
  .option("--perf-warmup-timeout-ms <ms>", "Warmup timeout in milliseconds (default: 300000)")
  .option("--perf-prompt-timeout-ms <ms>", "Per-prompt timeout in milliseconds (default: 120000)")
  .option("--perf-min-successful-prompts <count>", "Minimum successful perf prompts required (default: 3)")
  .option("--quality-timeout-ms <ms>", "Per-question timeout for quality benchmarks (default: 120000)")
  .option("--coding-timeout-ms <ms>", "Per-question timeout for coding benchmark (default: 240000)")
  .option(
    "--stream-stall-timeout-ms <ms>",
    "Abort any runtime stream if no chunk is received for <ms> (default: 30000, 0 disables)"
  )
  .option("--perf-strict", "Fail immediately if any performance prompt fails")
  .option("--share", "Share results on the public leaderboard (skip confirmation)")
  .option("--no-share", "Skip the share prompt entirely")
  .option("--keep-alive <duration>", "Runtime keep_alive value (seconds or duration string, e.g. 2m)")
  .option("--unload-after-bench", "Unload model(s) after benchmark completion")
  .option("--no-unload-after-bench", "Do not unload model(s) after benchmark completion")
  .option("--thinking", "Enable thinking mode (extended reasoning for supported models)")
  .option("--no-thinking", "Disable thinking mode")
  .option("--json", "Output results as JSON to stdout (no UI)")
  .option("--export <format>", "Export results: json | csv | md")
  .option("--out <dir>", "Export output directory (default: exports)")
  .option("--telemetry", "Enable anonymous usage stats")
  .option("--no-telemetry", "Disable anonymous usage stats")
  .action(async (opts) => {
    let backend: string | undefined;
    if (opts.backend !== undefined) {
      const parsedBackend = parseBackendOption(opts.backend);
      if (!parsedBackend) {
        process.exitCode = 1;
        return;
      }
      backend = parsedBackend;
    }

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

    const qualityTimeoutMs =
      opts.qualityTimeoutMs !== undefined
        ? parsePositiveIntegerOption(opts.qualityTimeoutMs, "--quality-timeout-ms")
        : undefined;
    if (opts.qualityTimeoutMs !== undefined && qualityTimeoutMs === null) {
      process.exitCode = 1;
      return;
    }

    const codingTimeoutMs =
      opts.codingTimeoutMs !== undefined
        ? parsePositiveIntegerOption(opts.codingTimeoutMs, "--coding-timeout-ms")
        : undefined;
    if (opts.codingTimeoutMs !== undefined && codingTimeoutMs === null) {
      process.exitCode = 1;
      return;
    }

    const streamStallTimeoutMs =
      opts.streamStallTimeoutMs !== undefined
        ? parseNonNegativeIntegerOption(
          opts.streamStallTimeoutMs,
          "--stream-stall-timeout-ms"
        )
        : undefined;
    if (
      opts.streamStallTimeoutMs !== undefined &&
      streamStallTimeoutMs === null
    ) {
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

    const thinkingOption =
      typeof opts.thinking === "boolean"
        ? opts.thinking
        : undefined;

    const outcome = await benchCommand({
      model: opts.model,
      backend,
      perfOnly: opts.perfOnly,
      perfWarmupTimeoutMs: perfWarmupTimeoutMs ?? undefined,
      perfPromptTimeoutMs: perfPromptTimeoutMs ?? undefined,
      perfMinSuccessfulPrompts: perfMinSuccessfulPrompts ?? undefined,
      qualityTimeoutMs: qualityTimeoutMs ?? undefined,
      codingTimeoutMs: codingTimeoutMs ?? undefined,
      streamStallTimeoutMs: streamStallTimeoutMs ?? undefined,
      perfStrict: Boolean(opts.perfStrict),
      share: shareOption,
      ciNoMenu: hasCiNoMenuFlag(process.argv.slice(2)),
      json: Boolean(opts.json),
      keepAlive: keepAlive ?? undefined,
      unloadAfterBench,
      thinking: thinkingOption,
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
  .description("List available runtime models")
  .option("--backend <name>", "Inference backend: ollama | lm-studio")
  .action(async (opts) => {
    let backend: string | undefined;
    if (opts.backend !== undefined) {
      const parsedBackend = parseBackendOption(opts.backend);
      if (!parsedBackend) {
        process.exitCode = 1;
        return;
      }
      backend = parsedBackend;
    }
    await listCommand({ backend });
  });

program
  .command("menu")
  .description("Open interactive menu")
  .action(async () => {
    await runInteractiveMenu({ updateCheckPromise });
  });

const argv = process.argv.slice(2);
if (shouldShortCircuitCiNoMenu(argv)) {
  printBanner();
  successMsg("CI non-interactive mode: no menu opened.");
} else if (argv.length === 0) {
  printBanner();
  if (!canUseInteractiveMenu(process.stdin.isTTY, process.stdout.isTTY)) {
    errorMsg("No interactive terminal detected. Use `metrillm --ci-no-menu` or a subcommand.");
    process.exitCode = 1;
  } else {
    await runInteractiveMenu({ updateCheckPromise });
    // Force exit — PostHog telemetry keeps the event loop alive otherwise.
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  }
} else {
  await program.parseAsync();
  // Force exit — PostHog telemetry keeps the event loop alive otherwise.
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
}
