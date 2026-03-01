import ora, { type Ora } from "ora";
import chalk from "chalk";
import { supportsUnicode } from "./terminal.js";

const FUN_PHRASES = [
  "Convincing the model to cooperate...",
  "Politely asking for more VRAM...",
  "Hallucinating responsibly...",
  "Converting caffeine to tokens...",
  "Fine-tuning the vibes...",
  "Warming up the silicon...",
  "Counting parameters one by one...",
  "Negotiating with the attention heads...",
  "Bribing the GPU scheduler...",
  "Tokenizing your patience...",
  "Performing gradient ascent on morale...",
  "Asking the model to show its work...",
  "Softmaxing expectations...",
  "Backpropagating through bureaucracy...",
  "Sampling from the distribution of outcomes...",
  "Applying dropout to your worries...",
  "Checking if P equals NP real quick...",
  "Loading weights... and lifting them...",
  "Running inference at the speed of thought...",
  "Embedding this moment in vector space...",
  "Quantizing your anticipation to 4 bits...",
  "Teaching the model some manners...",
  "Reticulating neural splines...",
  "Optimizing the loss of your free time...",
  "Asking nicely for coherent output...",
  "Unrolling loops and rolling eyes...",
  "Pruning unnecessary neurons...",
  "Feeding the transformer its daily prompts...",
  "Computing the meaning of life (in tok/s)...",
  "Performing attention — please hold...",
  "Cross-referencing with the vibes database...",
  "Adjusting temperature for maximum spice...",
  "Benchmarking the benchmarker...",
  "Consulting the oracle (it's just softmax)...",
  "Defragmenting the latent space...",
  "Compiling excuses for slow inference...",
  "Measuring tokens per existential crisis...",
  "Aligning the model with your expectations...",
  "Running a vibe check on the weights...",
  "Interpolating between hope and reality...",
  "Insert disk 2 and press left mouse button...",
  "Guru Meditation imminent — stay calm...",
  "Running LLM on an Amiga 500 would be faster... maybe...",
  "Asking Kickstart ROM for a second opinion...",
  "Swapping chip RAM for more tokens...",
];

const ROTATION_INTERVAL_MS = 3500;

const activeSpinners = new Set<Ora>();

process.on("exit", () => {
  for (const s of activeSpinners) {
    try {
      s.stop();
    } catch {
      // ignore
    }
  }
  activeSpinners.clear();
});

function attachFunSuffix(spinner: Ora): Ora {
  let timer: ReturnType<typeof setInterval> | null = null;
  let phraseIndex = Math.floor(Math.random() * FUN_PHRASES.length);

  const origStart = spinner.start.bind(spinner);
  const origStop = spinner.stop.bind(spinner);
  const origSucceed = spinner.succeed.bind(spinner);
  const origFail = spinner.fail.bind(spinner);

  function clearTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    spinner.suffixText = "";
    activeSpinners.delete(spinner);
  }

  function rotateSuffix(): void {
    phraseIndex = (phraseIndex + 1) % FUN_PHRASES.length;
    spinner.suffixText = chalk.dim(` — ${FUN_PHRASES[phraseIndex]}`);
  }

  spinner.start = ((text?: string) => {
    activeSpinners.add(spinner);
    origStart(text);
    spinner.suffixText = chalk.dim(` — ${FUN_PHRASES[phraseIndex]}`);
    timer = setInterval(rotateSuffix, ROTATION_INTERVAL_MS);
    return spinner;
  }) as typeof spinner.start;

  spinner.stop = (() => {
    clearTimer();
    return origStop();
  }) as typeof spinner.stop;

  spinner.succeed = ((text?: string) => {
    clearTimer();
    return origSucceed(text);
  }) as typeof spinner.succeed;

  spinner.fail = ((text?: string) => {
    clearTimer();
    return origFail(text);
  }) as typeof spinner.fail;

  return spinner;
}

export function createSpinner(text: string): Ora {
  const spinner = ora({
    text,
    color: "cyan",
    // Avoid interfering with readline-driven interactive menus.
    discardStdin: false,
  });
  return attachFunSuffix(spinner);
}

const STEP_MARKER = supportsUnicode ? "\u25B8" : ">";
const CHECK_MARK = supportsUnicode ? "\u2713" : "ok";
const CROSS_MARK = supportsUnicode ? "\u2717" : "!!";
const WARN_MARK = supportsUnicode ? "\u26A0" : "!!";
const INFO_MARK = supportsUnicode ? "\u2139" : "i";

export function stepHeader(text: string): void {
  console.log(chalk.bold.blue(`\n${STEP_MARKER} ${text}`));
}

export function subStep(text: string): void {
  console.log(chalk.dim(`  ${text}`));
}

export function successMsg(text: string): void {
  console.log(chalk.green(`  ${CHECK_MARK} ${text}`));
}

export function infoMsg(text: string): void {
  console.log(chalk.cyan(`  ${INFO_MARK} ${text}`));
}

export function warnMsg(text: string): void {
  console.log(chalk.yellow(`  ${WARN_MARK} ${text}`));
}

export function errorMsg(text: string): void {
  console.log(chalk.red(`  ${CROSS_MARK} ${text}`));
}
