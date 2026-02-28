import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { BenchResult } from "../types.js";
import { loadConfig, saveConfig } from "../core/store.js";

export type ShareDecision = "share" | "skip";

export async function promptShare(result: BenchResult): Promise<ShareDecision> {
  const config = await loadConfig();

  // If user has a saved preference, use it
  if (config.autoShare === true) return "share";
  if (config.autoShare === false) return "skip";

  // Interactive prompt (autoShare === "ask")
  if (!input.isTTY) return "skip";

  const model = result.model;
  const score = result.fitness.globalScore ?? result.fitness.hardwareFitScore;
  const verdict = result.fitness.verdict;
  const tps = result.performance.tokensPerSecond.toFixed(1);
  const ram = `${result.hardware.totalMemoryGB.toFixed(0)} GB`;

  console.log("");
  console.log(chalk.bold.green("  ✓ Benchmark complete!"));
  console.log("");
  console.log(chalk.dim(`    Score: ${score}/100 — ${verdict}`));
  console.log(chalk.dim(`    ${model} @ ${tps} tok/s (${ram} RAM)`));
  console.log("");
  console.log(
    chalk.bold("  📊 Share your result on the public leaderboard?")
  );
  console.log(
    chalk.dim("     Your hardware specs and scores will be published (no personal data).")
  );
  console.log("");

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      chalk.cyan("  [Y] Yes, share (default)  [n] No  [a] Always  [x] Never\n  > ")
    );

    const choice = answer.trim().toLowerCase();

    if (choice === "a" || choice === "always") {
      await saveConfig({ ...config, autoShare: true });
      return "share";
    }
    if (choice === "x" || choice === "never") {
      await saveConfig({ ...config, autoShare: false });
      return "skip";
    }
    if (choice === "n" || choice === "no") {
      return "skip";
    }
    // Default (empty / "y" / "yes" / anything else) = share
    return "share";
  } finally {
    rl.close();
  }
}
