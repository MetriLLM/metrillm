import chalk from "chalk";

const LOGO_LINES = [
  "██      ██      ██  ██  ██████ ████████ ██████ ██████ ",
  "██      ██      ██  ██  ██        ██    ██     ██  ██ ",
  "██      ██      ██████  ████      ██    ████   ██████ ",
  "██      ██      ██  ██  ██        ██    ██     ██ ██  ",
  "██████  ██████  ██  ██  ██████    ██    ██████ ██  ██ ",
];

interface ColorStop { r: number; g: number; b: number }

const GRADIENT_STOPS: ColorStop[] = [
  { r: 0, g: 255, b: 255 },   // cyan
  { r: 100, g: 180, b: 255 }, // sky blue
  { r: 50, g: 100, b: 255 },  // blue
  { r: 90, g: 60, b: 230 },   // indigo
  { r: 200, g: 50, b: 200 },  // magenta
];

function interpolateColor(stops: ColorStop[], t: number): ColorStop {
  const clamped = Math.max(0, Math.min(1, t));
  const segment = clamped * (stops.length - 1);
  const idx = Math.min(Math.floor(segment), stops.length - 2);
  const frac = segment - idx;
  const a = stops[idx];
  const b = stops[idx + 1];
  return {
    r: Math.round(a.r + (b.r - a.r) * frac),
    g: Math.round(a.g + (b.g - a.g) * frac),
    b: Math.round(a.b + (b.b - a.b) * frac),
  };
}

function gradientLine(line: string): string {
  const len = line.length;
  if (len === 0) return "";
  return line
    .split("")
    .map((ch, i) => {
      const t = len > 1 ? i / (len - 1) : 0;
      const { r, g, b } = interpolateColor(GRADIENT_STOPS, t);
      return chalk.rgb(r, g, b)(ch);
    })
    .join("");
}

const COPYRIGHT = "Copyright The Blue House, Cyril Guilleminot, 2026";
const PROJECT_URL =
  process.env.LLMETER_PROJECT_URL ??
  "https://github.com/MetriLLM/metrillm";

export function printBanner(): void {
  console.log("");
  for (const line of LOGO_LINES) {
    console.log(`  ${gradientLine(line)}`);
  }
  console.log("");
  console.log(
    chalk.dim("  Benchmark local LLMs — hardware fit, task quality, and global verdict")
  );
  console.log(chalk.dim(`  ${COPYRIGHT}`));
  console.log(chalk.dim(`  Source: ${PROJECT_URL}\n`));
}
