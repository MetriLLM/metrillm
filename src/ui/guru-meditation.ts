import chalk from "chalk";

const BLINK_CYCLES = 6;
const BLINK_INTERVAL_MS = 550;
const FRAME_HEIGHT = 7; // empty + border + empty + line1 + line2 + empty + border

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFrame(line1: string, line2: string, borderOn: boolean): string {
  const innerWidth = Math.max(line1.length, line2.length) + 6;
  const red = chalk.hex("#AA0000");
  const redBg = chalk.bgHex("#AA0000");

  const center = (text: string, w: number) => {
    const gap = Math.max(0, w - text.length);
    const left = Math.floor(gap / 2);
    const right = gap - left;
    return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
  };

  const totalWidth = innerWidth + 2;

  if (borderOn) {
    const hBorder = redBg(" ".repeat(totalWidth));
    const row = (text: string) => {
      const centered = center(text, innerWidth);
      return `${redBg(" ")}${red(centered)}${redBg(" ")}`;
    };
    const emptyRow = row("");
    return [
      "",
      hBorder,
      emptyRow,
      row(line1),
      row(line2),
      emptyRow,
      hBorder,
    ].join("\n");
  }

  // Border off: just red text, no border (black gap)
  const blank = " ".repeat(totalWidth);
  const row = (text: string) => {
    const centered = center(text, innerWidth);
    return ` ${red(centered)} `;
  };
  return [
    "",
    blank,
    row(""),
    row(line1),
    row(line2),
    row(""),
    blank,
  ].join("\n");
}

function guruLines(): { line1: string; line2: string } {
  const uptime = Math.floor(process.uptime() * 1000);
  const addr1 = (uptime & 0xffffffff).toString(16).toUpperCase().padStart(8, "0");
  const addr2 = ((process.pid * 0xfe1a) & 0xffffffff)
    .toString(16)
    .toUpperCase()
    .padStart(8, "0");
  return {
    line1: "Software Failure.  Press left mouse button to continue.",
    line2: `Guru Meditation #${addr1}.${addr2}`,
  };
}

/**
 * Synchronous version — single frame, no animation.
 * Used in signal handlers where async is not possible.
 */
export function printGuruMeditationSync(): void {
  const { line1, line2 } = guruLines();
  process.stdout.write(buildFrame(line1, line2, true) + "\n\n");
}

/**
 * Amiga-style "Guru Meditation" farewell message displayed on CLI exit.
 * Faithful recreation: red (#AA0000) border blinking on black background,
 * red centered text, pseudo-random error code.
 */
export async function printGuruMeditation(): Promise<void> {
  const { line1, line2 } = guruLines();

  const isTTY = process.stdout.isTTY;

  if (!isTTY) {
    // Non-interactive: just print once, no animation
    process.stdout.write(buildFrame(line1, line2, true) + "\n\n");
    return;
  }

  // Hide cursor during animation
  process.stdout.write("\x1B[?25l");

  for (let i = 0; i < BLINK_CYCLES * 2; i++) {
    const borderOn = i % 2 === 0;

    // Move cursor up to overwrite previous frame (except first iteration)
    if (i > 0) {
      process.stdout.write(`\x1B[${FRAME_HEIGHT}A`);
    }

    process.stdout.write(buildFrame(line1, line2, borderOn) + "\n");
    await sleep(BLINK_INTERVAL_MS);
  }

  // Ensure we end on border-ON state
  process.stdout.write(`\x1B[${FRAME_HEIGHT}A`);
  process.stdout.write(buildFrame(line1, line2, true) + "\n\n");

  // Restore cursor
  process.stdout.write("\x1B[?25h");
}
