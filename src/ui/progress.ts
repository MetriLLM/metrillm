import ora, { type Ora } from "ora";
import chalk from "chalk";

export function createSpinner(text: string): Ora {
  return ora({
    text,
    color: "cyan",
    // Avoid interfering with readline-driven interactive menus.
    discardStdin: false,
  });
}

export function stepHeader(text: string): void {
  console.log(chalk.bold.blue(`\n▸ ${text}`));
}

export function subStep(text: string): void {
  console.log(chalk.dim(`  ${text}`));
}

export function successMsg(text: string): void {
  console.log(chalk.green(`  ✓ ${text}`));
}

export function warnMsg(text: string): void {
  console.log(chalk.yellow(`  ⚠ ${text}`));
}

export function errorMsg(text: string): void {
  console.log(chalk.red(`  ✗ ${text}`));
}
