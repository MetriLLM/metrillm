import chalk from "chalk";
import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

/**
 * Prompt the user to enable thinking mode (y/N).
 * Returns `true` if the user opted in, `false` otherwise.
 */
export async function promptThinkingMode(): Promise<boolean> {
  if (!input.isTTY || !output.isTTY) return false;

  const previousRawMode = input.isTTY ? input.isRaw : false;
  if (input.isTTY && previousRawMode) {
    input.setRawMode(false);
  }

  const rl = readline.createInterface({ input, output });

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      rl.close();
      if (input.isTTY && previousRawMode) {
        input.setRawMode(previousRawMode);
      }
      resolve(value);
    };

    rl.on("close", () => finish(false));

    rl.question(
      chalk.cyan("?") + chalk.bold(" Enable thinking mode?") + chalk.dim(" (y/N) "),
      (answer) => {
        finish(answer.trim().toLowerCase() === "y");
      }
    );
  });
}
