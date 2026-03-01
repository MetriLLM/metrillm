import chalk from "chalk";
import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import type { BenchResult } from "../types.js";
import { loadConfig, saveConfig } from "../core/store.js";
import { supportsUnicode } from "./terminal.js";

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

function renderShareMenu(result: BenchResult, selectedIndex: number, lastRenderedLines = 0): number {
  const score = result.fitness.globalScore ?? result.fitness.hardwareFitScore;
  const verdict = result.fitness.verdict;
  const tps = result.performance.tokensPerSecond.toFixed(1);
  const ram = `${result.hardware.totalMemoryGB.toFixed(0)} GB`;

  const lines: string[] = [];
  lines.push(chalk.bold.cyan("Share Result"));
  lines.push(chalk.dim("Use Up/Down arrows then Enter, or press 1-3 on keyboard/numpad."));
  lines.push(chalk.dim("Shortcuts: y = share, n = skip, a = always. Esc = skip."));
  lines.push("");
  const checkMark = supportsUnicode ? "\u2713" : "ok";
  lines.push(chalk.bold.green(`  ${checkMark} Benchmark complete!`));
  lines.push(chalk.dim(`    Score: ${score}/100 — ${verdict}`));
  lines.push(chalk.dim(`    ${result.model} @ ${tps} tok/s (${ram} RAM)`));
  lines.push("");
  lines.push(chalk.bold("  Share your result on the public leaderboard?"));
  lines.push(chalk.dim("     Your hardware specs and scores will be published (no personal data)."));
  lines.push("");

  for (let i = 0; i < SHARE_OPTIONS.length; i++) {
    const option = SHARE_OPTIONS[i];
    const marker = i === selectedIndex ? chalk.cyan(">") : " ";
    const label = i === selectedIndex ? chalk.bold(option.label) : option.label;
    const ordinal = `${i + 1}.`.padStart(3);
    lines.push(` ${marker} ${chalk.dim(ordinal)} ${label}`);
    lines.push(chalk.dim(`    ${option.hint}`));
  }

  if (lastRenderedLines > 0) {
    output.write(`\x1b[${lastRenderedLines}A`);
  }

  for (const line of lines) {
    output.write(line + "\x1b[K\n");
  }

  return lines.length;
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
    let lastRenderedLines = 0;
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
        lastRenderedLines = renderShareMenu(result, index, lastRenderedLines);
        return;
      }

      if (key.name === "down" || key.name === "j") {
        index = (index + 1) % SHARE_OPTIONS.length;
        lastRenderedLines = renderShareMenu(result, index, lastRenderedLines);
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
    lastRenderedLines = renderShareMenu(result, index, lastRenderedLines);
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
