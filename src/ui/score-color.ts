import chalk from "chalk";

export type ColorFn = (text: string) => string;

export function scoreColor(score: number): ColorFn {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.blue;
  if (score >= 40) return chalk.yellow;
  return chalk.red;
}
