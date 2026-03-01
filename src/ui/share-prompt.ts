import chalk from "chalk";
import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import type { BenchResult } from "../types.js";
import { loadConfig, saveConfig } from "../core/store.js";

export type ShareDecision = "share" | "skip";
type ShareChoice = "share" | "skip" | "always";

interface SharePromptDeps {
  selectChoice?: (result: BenchResult) => Promise<ShareChoice>;
}

interface ShareOption {
  label: string;
  hint: string;
  value: ShareChoice;
}

const SHARE_OPTIONS: ShareOption[] = [
  { label: "Yes, share now", hint: "Upload this benchmark result to the public leaderboard.", value: "share" },
  { label: "No (this run only)", hint: "Skip upload for this benchmark run only.", value: "skip" },
  { label: "Always share", hint: "Save preference and automatically share future results.", value: "always" },
];

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

function clearTerminal(): void {
  if (output.isTTY) {
    output.write("\x1b[2J\x1b[H");
  }
}

function renderShareMenu(result: BenchResult, selectedIndex: number): void {
  const score = result.fitness.globalScore ?? result.fitness.hardwareFitScore;
  const verdict = result.fitness.verdict;
  const tps = result.performance.tokensPerSecond.toFixed(1);
  const ram = `${result.hardware.totalMemoryGB.toFixed(0)} GB`;

  clearTerminal();
  console.log(chalk.bold.cyan("Share Result"));
  console.log(chalk.dim("Use Up/Down arrows then Enter, or press 1-3 on keyboard/numpad."));
  console.log(chalk.dim("Shortcuts: y = share, n = skip, a = always. Esc = skip."));
  console.log("");
  console.log(chalk.bold.green("  ✓ Benchmark complete!"));
  console.log(chalk.dim(`    Score: ${score}/100 — ${verdict}`));
  console.log(chalk.dim(`    ${result.model} @ ${tps} tok/s (${ram} RAM)`));
  console.log("");
  console.log(chalk.bold("  📊 Share your result on the public leaderboard?"));
  console.log(chalk.dim("     Your hardware specs and scores will be published (no personal data)."));
  console.log("");

  for (let i = 0; i < SHARE_OPTIONS.length; i++) {
    const option = SHARE_OPTIONS[i];
    const marker = i === selectedIndex ? chalk.cyan(">") : " ";
    const label = i === selectedIndex ? chalk.bold(option.label) : option.label;
    const ordinal = `${i + 1}.`.padStart(3);
    console.log(` ${marker} ${chalk.dim(ordinal)} ${label}`);
    console.log(chalk.dim(`    ${option.hint}`));
  }
}

function parseChoiceFromKey(str: string, keyName?: string): ShareChoice | null {
  const value = (keyName ?? str).toLowerCase();
  const directMap: Record<string, ShareChoice> = {
    "1": "share",
    "2": "skip",
    "3": "always",
    y: "share",
    n: "skip",
    a: "always",
  };

  if (value in directMap) {
    return directMap[value];
  }

  if (value === "numpad1" || value === "kp1") return "share";
  if (value === "numpad2" || value === "kp2") return "skip";
  if (value === "numpad3" || value === "kp3") return "always";
  return null;
}

async function selectShareChoice(result: BenchResult): Promise<ShareChoice> {
  return new Promise((resolve) => {
    let index = 0;
    const previousRawMode = input.isTTY ? input.isRaw : false;

    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (input.isTTY) {
        input.setRawMode(previousRawMode);
      }
      output.write("\x1b[?25h");
    };

    const finish = (choice: ShareChoice) => {
      cleanup();
      resolve(choice);
    };

    const onKeypress = (str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }

      const quickChoice = parseChoiceFromKey(str, key.name);
      if (quickChoice) {
        finish(quickChoice);
        return;
      }

      if (key.name === "up" || key.name === "k") {
        index = (index - 1 + SHARE_OPTIONS.length) % SHARE_OPTIONS.length;
        renderShareMenu(result, index);
        return;
      }

      if (key.name === "down" || key.name === "j") {
        index = (index + 1) % SHARE_OPTIONS.length;
        renderShareMenu(result, index);
        return;
      }

      if (isEnterKey(str, key.name)) {
        finish(SHARE_OPTIONS[index]!.value);
        return;
      }

      if (key.name === "escape") {
        finish("skip");
      }
    };

    readline.emitKeypressEvents(input);
    input.resume();
    if (input.isTTY) {
      input.setRawMode(true);
    }

    output.write("\x1b[?25l");
    renderShareMenu(result, index);
    input.on("keypress", onKeypress);
  });
}

export async function promptShare(
  result: BenchResult,
  deps: SharePromptDeps = {}
): Promise<ShareDecision> {
  const config = await loadConfig();

  // If user has a saved preference, use it
  if (config.autoShare === true) return "share";

  // Interactive prompt (autoShare === "ask")
  if (!input.isTTY || !output.isTTY) return "skip";

  const choice = await (deps.selectChoice ?? selectShareChoice)(result);

  if (choice === "always") {
    await saveConfig({ ...config, autoShare: true });
    return "share";
  }
  if (choice === "skip") {
    return "skip";
  }
  return "share";
}
