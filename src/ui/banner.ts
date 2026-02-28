import chalk from "chalk";

const LOGO = `
  _     _     __  __      _
 | |   | |   |  \\/  |    | |
 | |   | |   | \\  / | ___| |_ ___ _ __
 | |   | |   | |\\/| |/ _ \\ __/ _ \\ '__|
 | |___| |___| |  | |  __/ ||  __/ |
 |_____|_____|_|  |_|\\___|\\__\\___|_|
`;

const COPYRIGHT = "Copyright The Blue House, Cyril Guilleminot, 2026";
const PROJECT_URL =
  process.env.LLMETER_PROJECT_URL ??
  "https://github.com/MetriLLM/metrillm";

export function printBanner(): void {
  console.log(chalk.cyan(LOGO));
  console.log(
    chalk.dim("  Benchmark local LLMs — hardware fit, task quality, and global verdict")
  );
  console.log(chalk.dim(`  ${COPYRIGHT}`));
  console.log(chalk.dim(`  Source: ${PROJECT_URL}\n`));
}
