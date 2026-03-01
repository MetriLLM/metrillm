import chalk from "chalk";
import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { benchCommand } from "../commands/bench.js";
import { listCommand } from "../commands/list.js";
import { getHardwareInfo } from "../core/hardware.js";
import { printHardwareTable } from "./results-table.js";
import { infoMsg, createSpinner } from "./progress.js";
import { exportBenchResults, type ExportFormat } from "../core/exporter.js";
import { loadConfig, saveConfig, type LLMeterConfig } from "../core/store.js";
import { saveTelemetryConsent } from "../core/telemetry.js";
import type { BenchResult } from "../types.js";
import { errorMsg, successMsg, warnMsg } from "./progress.js";
import { printGuruMeditation } from "./guru-meditation.js";
import { promptAndSaveSubmitterProfile } from "./submitter-prompt.js";

interface MenuOption<T> {
  label: string;
  value: T;
  hint?: string;
}

interface SelectOptions {
  subtitle?: string;
  allowEscape?: boolean;
}

function isEnterKey(str: string, keyName?: string): boolean {
  return (
    keyName === "return"
    || keyName === "enter"
    || keyName === "numenter"
    || keyName === "kpenter"
    || str === "\r"
    || str === "\n"
  );
}

function canUseArrowMenu(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

function restoreTerminalForExit(): void {
  if (output.isTTY) {
    output.write("\x1b[?25h");
  }
  if (input.isTTY && input.isRaw) {
    input.setRawMode(false);
  }
  input.pause();
}

function renderMenu<T>(
  title: string,
  options: MenuOption<T>[],
  selectedIndex: number,
  config: SelectOptions = {},
  typedChoice = "",
  lastRenderedLines = 0
): number {
  const lines: string[] = [];
  lines.push(chalk.bold.cyan(title));
  if (config.subtitle) {
    lines.push(chalk.dim(config.subtitle));
  }
  const navHelp = options.length <= 9
    ? "Use Up/Down arrows then Enter, or press a number key."
    : "Use Up/Down arrows then Enter, or type a number then Enter.";
  const backHelp = config.allowEscape !== false ? " Esc to go back." : "";
  lines.push(chalk.dim(`${navHelp}${backHelp}`));
  if (typedChoice.length > 0) {
    lines.push(chalk.dim(`Typed shortcut: ${typedChoice}`));
  }
  lines.push("");

  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const marker = i === selectedIndex ? chalk.cyan(">") : " ";
    const label = i === selectedIndex ? chalk.bold(option.label) : option.label;
    const ordinal = `${i + 1}.`.padStart(3);
    lines.push(` ${marker} ${chalk.dim(ordinal)} ${label}`);
    if (option.hint) {
      lines.push(chalk.dim(`    ${option.hint}`));
    }
  }

  // Move cursor up to overwrite previous frame (except first render)
  if (lastRenderedLines > 0) {
    output.write(`\x1b[${lastRenderedLines}A`);
  }

  for (const line of lines) {
    output.write(line + "\x1b[K\n");
  }

  // Clear leftover lines from previous render (e.g. typedChoice disappeared)
  for (let i = lines.length; i < lastRenderedLines; i++) {
    output.write("\x1b[K\n");
  }
  // Move cursor back up to end of current content if we wrote extra blank lines
  if (lastRenderedLines > lines.length) {
    output.write(`\x1b[${lastRenderedLines - lines.length}A`);
  }

  return lines.length;
}

async function promptText(prompt: string): Promise<string | null> {
  if (!input.readable || input.readableEnded) {
    return null;
  }

  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      input.off("end", onEnd);
      rl.off("close", onClose);
      try {
        rl.close();
      } catch {
        // ignore close errors
      }
      resolve(value);
    };

    const onEnd = () => finish(null);
    const onClose = () => finish(null);

    input.once("end", onEnd);
    rl.once("close", onClose);

    rl.question(prompt, (answer) => {
      finish(answer);
    });
  });
}

async function selectWithArrows<T>(
  title: string,
  options: MenuOption<T>[],
  config: SelectOptions = {}
): Promise<T | null> {
  return new Promise((resolve) => {
    let index = 0;
    let typedChoice = "";
    let lastRenderedLines = 0;
    const allowEscape = config.allowEscape !== false;
    const previousRawMode = input.isTTY ? input.isRaw : false;
    const maxDigits = Math.max(1, String(options.length).length);

    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (input.isTTY) {
        input.setRawMode(previousRawMode);
      }
      output.write("\x1b[?25h");
    };

    const render = () => {
      lastRenderedLines = renderMenu(title, options, index, config, typedChoice, lastRenderedLines);
    };

    const resolveByNumber = (choice: number) => {
      if (allowEscape && choice === 0) {
        cleanup();
        resolve(null);
        return true;
      }
      if (choice >= 1 && choice <= options.length) {
        cleanup();
        resolve(options[choice - 1]?.value ?? null);
        return true;
      }
      return false;
    };

    const onKeypress = (str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }

      const keyToken = key.name ?? str;
      if (/^[0-9]$/.test(keyToken)) {
        const digit = Number.parseInt(keyToken, 10);

        if (options.length <= 9) {
          if (!resolveByNumber(digit)) {
            output.write("\x07");
            render();
          }
          return;
        }

        if (typedChoice === "0") {
          typedChoice = keyToken;
        } else if (typedChoice.length >= maxDigits) {
          typedChoice = keyToken;
        } else {
          typedChoice += keyToken;
        }

        const choice = Number.parseInt(typedChoice, 10);
        if (choice >= 1 && choice <= options.length) {
          index = choice - 1;
        }
        render();
        return;
      }

      if (key.name === "backspace" || key.name === "delete") {
        if (typedChoice.length > 0) {
          typedChoice = typedChoice.slice(0, -1);
          render();
        }
        return;
      }

      if (key.name === "up" || key.name === "k") {
        typedChoice = "";
        index = (index - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key.name === "down" || key.name === "j") {
        typedChoice = "";
        index = (index + 1) % options.length;
        render();
        return;
      }

      if (isEnterKey(str, key.name)) {
        if (typedChoice.length > 0) {
          const choice = Number.parseInt(typedChoice, 10);
          if (!resolveByNumber(choice)) {
            typedChoice = "";
            render();
          }
          return;
        }
        const selected = options[index]?.value ?? null;
        cleanup();
        resolve(selected);
        return;
      }

      if (key.name === "escape" && allowEscape) {
        cleanup();
        resolve(null);
      }
    };

    readline.emitKeypressEvents(input);
    input.resume();
    if (input.isTTY) {
      input.setRawMode(true);
    }

    output.write("\x1b[?25l");
    render();
    input.on("keypress", onKeypress);
  });
}

async function selectWithPrompt<T>(
  title: string,
  options: MenuOption<T>[],
  config: SelectOptions = {}
): Promise<T | null> {
  while (true) {
    console.log(chalk.bold.cyan(`\n${title}`));
    if (config.subtitle) {
      console.log(chalk.dim(config.subtitle));
    }

    for (let i = 0; i < options.length; i++) {
      console.log(`  ${i + 1}) ${options[i].label}`);
    }
    if (config.allowEscape !== false) {
      console.log("  0) Back");
    }

    const answer = await promptText("Choose an option > ");
    if (answer === null) return null;

    const trimmed = answer.trim();
    if (trimmed === "") {
      warnMsg("Invalid choice.");
      continue;
    }

    if (!/^\d+$/.test(trimmed)) {
      warnMsg("Invalid choice.");
      continue;
    }

    const choice = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(choice)) {
      warnMsg("Invalid choice.");
      continue;
    }

    if (choice === 0 && config.allowEscape !== false) {
      return null;
    }

    const idx = choice - 1;
    if (idx < 0 || idx >= options.length) {
      warnMsg("Invalid choice.");
      continue;
    }

    return options[idx].value;
  }
}

async function selectOption<T>(
  title: string,
  options: MenuOption<T>[],
  config: SelectOptions = {}
): Promise<T | null> {
  if (options.length === 0) return null;
  if (canUseArrowMenu()) {
    return selectWithArrows(title, options, config);
  }
  return selectWithPrompt(title, options, config);
}

async function waitForContinue(message = "Press Enter to continue..."): Promise<void> {
  if (!canUseArrowMenu()) {
    await promptText(`${message} `);
    return;
  }

  output.write(`\n${chalk.dim(message)}\n`);
  await new Promise<void>((resolve) => {
    const previousRawMode = input.isTTY ? input.isRaw : false;

    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (input.isTTY) input.setRawMode(previousRawMode);
      output.write("\x1b[?25h");
      resolve();
    };

    const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }
      if (isEnterKey(_str, key.name) || key.name === "escape" || key.name === "space") {
        cleanup();
      }
    };

    readline.emitKeypressEvents(input);
    input.resume();
    if (input.isTTY) input.setRawMode(true);
    output.write("\x1b[?25l");
    input.on("keypress", onKeypress);
  });
}

async function chooseExportFormat(): Promise<ExportFormat | null> {
  return selectOption<ExportFormat>(
    "Export Results",
    [
      { label: "JSON", value: "json", hint: "Best for scripts and automation." },
      { label: "CSV", value: "csv", hint: "Spreadsheet-friendly table format." },
      { label: "Markdown", value: "md", hint: "Readable report for docs." },
    ],
    {
      subtitle: "Choose the output format.",
      allowEscape: true,
    }
  );
}

async function chooseExportDirectory(): Promise<string | null> {
  const destination = await selectOption<"default" | "custom">(
    "Export Destination",
    [
      { label: "Use default folder: exports/", value: "default" },
      { label: "Choose custom folder path", value: "custom" },
    ],
    {
      subtitle: "Esc to cancel export.",
      allowEscape: true,
    }
  );

  if (!destination) return null;
  if (destination === "default") return "exports";

  const custom = await promptText("Custom output directory > ");
  if (custom === null) return null;
  const trimmed = custom.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function exportLastResults(results: BenchResult[]): Promise<void> {
  if (results.length === 0) {
    warnMsg("No results to export yet. Run a benchmark first.");
    await waitForContinue();
    return;
  }

  const format = await chooseExportFormat();
  if (!format) return;

  const outDir = await chooseExportDirectory();
  if (!outDir) return;

  try {
    const exported = await exportBenchResults(results, format, outDir);
    successMsg(`Results exported: ${exported}`);
  } catch (err) {
    errorMsg("Failed to export results.");
    if (err instanceof Error) errorMsg(err.message);
  }

  await waitForContinue();
}

function printQuickCommands(): void {
  console.log(chalk.bold("\nUseful Commands"));
  console.log(chalk.dim("  Use these commands if you want to skip the interactive menu."));
  console.log("  llmeter list");
  console.log("  llmeter bench --model <model-name>");
  console.log("  llmeter bench --model <model-name> --perf-only");
  console.log("  llmeter bench --model <model-name> --perf-prompt-timeout-ms 90000");
  console.log("  llmeter bench --model <model-name> --export json --out exports");
  console.log("  llmeter --ci-no-menu");
  console.log("  llmeter bench");
  console.log("  llmeter menu");
}

function mainMenuOptions(): MenuOption<
  "list" | "bench-one" | "bench-all" | "hardware" | "settings" | "export" | "help" | "exit"
>[] {
  return [
    {
      label: "List available models",
      value: "list",
      hint: "Show installed Ollama models and their load status.",
    },
    {
      label: "Benchmark one model",
      value: "bench-one",
      hint: "Best for focused analysis and quick iteration.",
    },
    {
      label: "Benchmark all models",
      value: "bench-all",
      hint: "Compare all local models under the same conditions.",
    },
    {
      label: "Check hardware config",
      value: "hardware",
      hint: "Detect and display hardware info without running a benchmark.",
    },
    {
      label: "Settings",
      value: "settings",
      hint: "Configure auto-share, benchmark profile, and telemetry preferences.",
    },
    {
      label: "Export last benchmark results",
      value: "export",
      hint: "Save JSON, CSV, or Markdown report.",
    },
    {
      label: "Show useful CLI commands",
      value: "help",
      hint: "Non-interactive commands for scripts or direct usage.",
    },
    {
      label: "Exit",
      value: "exit",
    },
  ];
}

function nextActionOptions(): MenuOption<"rerun" | "export" | "menu" | "quit">[] {
  return [
    { label: "Re-run same benchmark", value: "rerun" },
    { label: "Export last results", value: "export" },
    { label: "Back to main menu", value: "menu" },
    { label: "Quit", value: "quit" },
  ];
}

export type NextActionSelection = "rerun" | "export" | "menu" | "quit" | null;
export type PostBenchmarkAction = "rerun" | "menu" | "quit";
export type SettingsSelection =
  | "toggle-auto-share"
  | "edit-submitter-profile"
  | "clear-submitter-profile"
  | "toggle-telemetry"
  | "back"
  | null;

interface SettingsMenuDeps {
  loadUserConfig?: () => Promise<LLMeterConfig>;
  saveUserConfig?: (config: LLMeterConfig) => Promise<void>;
  saveTelemetryPref?: (value: boolean) => Promise<void>;
  selectSettingsAction?: (
    autoShareEnabled: boolean,
    telemetryEnabled: boolean,
    hasSubmitterProfile: boolean
  ) => Promise<SettingsSelection>;
  promptSubmitterProfile?: () => Promise<{ nickname: string; email: string } | null>;
  waitForAcknowledge?: (message?: string) => Promise<void>;
}

function settingsMenuOptions(
  autoShareEnabled: boolean,
  telemetryEnabled: boolean,
  hasSubmitterProfile: boolean
): MenuOption<
  Exclude<SettingsSelection, null>
>[] {
  return [
    {
      label: `Auto-share full benchmarks: ${autoShareEnabled ? "ON" : "OFF"}`,
      value: "toggle-auto-share",
      hint: autoShareEnabled ? "Disable to ask before each upload." : "Enable to share results automatically after each benchmark.",
    },
    {
      label: `Benchmark profile: ${hasSubmitterProfile ? "SET" : "NOT SET"}`,
      value: "edit-submitter-profile",
      hint: "Nickname + email used to link shared runs to your future dashboard account.",
    },
    {
      label: "Clear benchmark profile",
      value: "clear-submitter-profile",
      hint: "Remove locally saved nickname/email.",
    },
    {
      label: `Telemetry: ${telemetryEnabled ? "ON" : "OFF"}`,
      value: "toggle-telemetry",
      hint: telemetryEnabled ? "Disable anonymous usage stats." : "Enable anonymous usage stats.",
    },
    {
      label: "Back to main menu",
      value: "back",
    },
  ];
}

async function defaultSelectSettingsAction(
  autoShareEnabled: boolean,
  telemetryEnabled: boolean,
  hasSubmitterProfile: boolean
): Promise<SettingsSelection> {
  return selectOption(
    "Settings",
    settingsMenuOptions(autoShareEnabled, telemetryEnabled, hasSubmitterProfile),
    {
      subtitle: "Manage preferences. Esc to return to main menu.",
      allowEscape: true,
    }
  );
}

interface PostBenchmarkActionDeps {
  selectAction?: () => Promise<NextActionSelection>;
  exportResults?: (results: BenchResult[]) => Promise<void>;
}

export async function choosePostBenchmarkAction(
  results: BenchResult[],
  deps: PostBenchmarkActionDeps = {}
): Promise<PostBenchmarkAction> {
  const selectAction =
    deps.selectAction ??
    (() =>
      selectOption(
        "Next Action",
        nextActionOptions(),
        {
          subtitle: "Use Enter to confirm, Esc to return to main menu.",
          allowEscape: true,
        }
      ));
  const exportResults = deps.exportResults ?? exportLastResults;

  while (true) {
    const action = await selectAction();

    if (action === "export") {
      await exportResults(results);
      // Stay in the action menu after export; do not trigger benchmark rerun.
      continue;
    }

    if (action === "rerun") return "rerun";
    if (action === "quit") return "quit";
    return "menu";
  }
}

export async function runSettingsMenu(deps: SettingsMenuDeps = {}): Promise<void> {
  const loadUserConfig = deps.loadUserConfig ?? loadConfig;
  const saveUserConfig = deps.saveUserConfig ?? saveConfig;
  const saveTelemetryPref = deps.saveTelemetryPref ?? saveTelemetryConsent;
  const promptSubmitterProfile = deps.promptSubmitterProfile
    ?? (() => promptAndSaveSubmitterProfile({ loadUserConfig, saveUserConfig }));
  const waitForAcknowledge = deps.waitForAcknowledge ?? waitForContinue;

  while (true) {
    const config = await loadUserConfig();
    const autoShareEnabled = config.autoShare === true;
    const telemetryEnabled = config.telemetry === true;
    const hasSubmitterProfile = Boolean(config.submitterNickname && config.submitterEmail);
    const action =
      (await (deps.selectSettingsAction ?? defaultSelectSettingsAction)(
        autoShareEnabled,
        telemetryEnabled,
        hasSubmitterProfile
      )) ?? null;

    if (!action || action === "back") {
      return;
    }

    if (action === "toggle-auto-share") {
      const nextAutoShare: LLMeterConfig["autoShare"] = autoShareEnabled ? "ask" : true;
      try {
        await saveUserConfig({ ...config, autoShare: nextAutoShare });
        successMsg(`Auto-share ${nextAutoShare === true ? "enabled" : "disabled"}.`);
      } catch (err) {
        errorMsg("Could not update auto-share setting.");
        if (err instanceof Error) errorMsg(err.message);
      }
      await waitForAcknowledge("Press Enter to continue...");
      continue;
    }

    if (action === "edit-submitter-profile") {
      try {
        const savedProfile = await promptSubmitterProfile();
        if (savedProfile) {
          successMsg(`Benchmark profile saved for ${savedProfile.nickname}.`);
        } else {
          warnMsg("Benchmark profile unchanged.");
        }
      } catch (err) {
        errorMsg("Could not update benchmark profile.");
        if (err instanceof Error) errorMsg(err.message);
      }
      await waitForAcknowledge("Press Enter to continue...");
      continue;
    }

    if (action === "clear-submitter-profile") {
      if (!hasSubmitterProfile) {
        warnMsg("No benchmark profile is currently saved.");
      } else {
        try {
          await saveUserConfig({
            ...config,
            submitterNickname: undefined,
            submitterEmail: undefined,
          });
          successMsg("Benchmark profile removed.");
        } catch (err) {
          errorMsg("Could not clear benchmark profile.");
          if (err instanceof Error) errorMsg(err.message);
        }
      }
      await waitForAcknowledge("Press Enter to continue...");
      continue;
    }

    const nextTelemetry = !telemetryEnabled;
    try {
      await saveTelemetryPref(nextTelemetry);
      successMsg(`Telemetry ${nextTelemetry ? "enabled" : "disabled"}.`);
    } catch (err) {
      errorMsg("Could not update telemetry setting.");
      if (err instanceof Error) errorMsg(err.message);
    }
    await waitForAcknowledge("Press Enter to continue...");
  }
}

export async function runInteractiveMenu(): Promise<void> {
  let lastResults: BenchResult[] = [];

  while (true) {
    const mainChoice = await selectOption(
      "Main Menu",
      mainMenuOptions(),
      {
        subtitle:
          "Goal: estimate real-world fit. Global verdict combines Hardware Fit + Task Quality; quality stays directional (dataset-based).",
        allowEscape: false,
      }
    );

    if (mainChoice === null || mainChoice === "exit") {
      restoreTerminalForExit();
      await printGuruMeditation();
      break;
    }

    if (mainChoice === "list") {
      await listCommand({ setExitCode: false });
      await waitForContinue("Press Enter to return to menu...");
      continue;
    }

    if (mainChoice === "help") {
      printQuickCommands();
      await waitForContinue("Press Enter to return to menu...");
      continue;
    }

    if (mainChoice === "hardware") {
      const spinner = createSpinner("Detecting hardware...");
      spinner.start();
      try {
        const hardware = await getHardwareInfo();
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
      } catch (err) {
        spinner.fail("Hardware detection failed");
        if (err instanceof Error) errorMsg(err.message);
      }
      await waitForContinue("Press Enter to return to menu...");
      continue;
    }

    if (mainChoice === "settings") {
      await runSettingsMenu();
      continue;
    }

    if (mainChoice === "export") {
      await exportLastResults(lastResults);
      continue;
    }

    if (mainChoice === "bench-one") {
      const listing = await listCommand({ setExitCode: false });
      if (!listing.reachable) {
        await waitForContinue("Cannot reach Ollama. Press Enter to return...");
        continue;
      }
      if (listing.models.length === 0) {
        await waitForContinue("No models available. Press Enter to return...");
        continue;
      }

      const runningNames = new Set(listing.running.map((m) => m.name));
      const selectedModel = await selectOption<string>(
        "Select Model",
        listing.models.map((m) => ({
          label: m.name,
          value: m.name,
          hint: runningNames.has(m.name) ? "loaded" : "idle",
        })),
        {
          subtitle: "Choose a model to benchmark. Esc to return.",
          allowEscape: true,
        }
      );

      if (!selectedModel) {
        continue;
      }

      const mode = await selectOption<"full" | "perf">(
        "Benchmark Mode",
        [
          {
            label: "Full benchmark",
            value: "full",
            hint: "Performance + Task Quality + Global verdict.",
          },
          {
            label: "Performance only",
            value: "perf",
            hint: "Faster run; skips quality tasks.",
          },
        ],
        {
          subtitle: "Select benchmark depth. Esc to return.",
          allowEscape: true,
        }
      );

      if (!mode) {
        continue;
      }

      const perfOnly = mode === "perf";

      while (true) {
        let currentRunResults: BenchResult[] = [];
        const { results } = await benchCommand({
          model: selectedModel,
          perfOnly,
          setExitCode: false,
        });

        if (results.length > 0) {
          lastResults = results;
          currentRunResults = results;
        }

        if (currentRunResults.length === 0) {
          await waitForContinue(
            "Benchmark failed for this run. Press Enter to return to menu..."
          );
          break;
        }

        await waitForContinue(
          "Benchmark finished. Press Enter to open next actions..."
        );

        const action = await choosePostBenchmarkAction(currentRunResults);
        if (action === "rerun") {
          continue;
        }
        if (action === "quit") {
          restoreTerminalForExit();
          await printGuruMeditation();
          return;
        }
        break;
      }

      continue;
    }

    if (mainChoice === "bench-all") {
      const mode = await selectOption<"full" | "perf">(
        "Benchmark All Models",
        [
          {
            label: "Full benchmark on all models",
            value: "full",
            hint: "Performance + quality tasks + global verdict; can take longer.",
          },
          {
            label: "Performance-only benchmark on all models",
            value: "perf",
            hint: "Fastest comparison; skips quality tasks.",
          },
        ],
        {
          subtitle: "Esc to return without running.",
          allowEscape: true,
        }
      );

      if (!mode) {
        continue;
      }

      const perfOnly = mode === "perf";

      while (true) {
        let currentRunResults: BenchResult[] = [];
        const { results } = await benchCommand({
          perfOnly,
          setExitCode: false,
        });

        if (results.length > 0) {
          lastResults = results;
          currentRunResults = results;
        }

        if (currentRunResults.length === 0) {
          await waitForContinue(
            "Benchmark failed for this run. Press Enter to return to menu..."
          );
          break;
        }

        await waitForContinue(
          "Benchmark finished. Press Enter to open next actions..."
        );

        const action = await choosePostBenchmarkAction(currentRunResults);
        if (action === "rerun") {
          continue;
        }
        if (action === "quit") {
          restoreTerminalForExit();
          await printGuruMeditation();
          return;
        }
        break;
      }
    }
  }
}
