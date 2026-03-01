import chalk from "chalk";
import Table from "cli-table3";
import { listModels, listRunningModels } from "../core/runtime.js";
import { formatBytes } from "../utils.js";
import { createSpinner, errorMsg, warnMsg } from "../ui/progress.js";
import type { OllamaModel, OllamaRunningModel } from "../types.js";

export interface ListOptions {
  setExitCode?: boolean;
}

export interface ListOutcome {
  models: OllamaModel[];
  running: OllamaRunningModel[];
  reachable: boolean;
}

export async function listCommand(options: ListOptions = {}): Promise<ListOutcome> {
  const shouldSetExitCode = options.setExitCode !== false;
  const spinner = createSpinner("Fetching models from Ollama...");
  spinner.start();

  try {
    const models = await listModels();
    let running: OllamaRunningModel[] = [];
    try {
      running = await listRunningModels();
    } catch (err) {
      warnMsg("Could not query running model status; showing all models as idle.");
      if (err instanceof Error) {
        warnMsg(err.message);
      }
    }

    spinner.succeed(`Found ${models.length} model(s)`);

    if (models.length === 0) {
      console.log(chalk.yellow("\nNo models found. Pull one with: ollama pull <model>"));
      return { models, running, reachable: true };
    }

    const runningNames = new Set(running.map((r) => r.name));

    const table = new Table({
      head: [
        chalk.bold("Model"),
        chalk.bold("Size"),
        chalk.bold("Params"),
        chalk.bold("Quant"),
        chalk.bold("Family"),
        chalk.bold("Status"),
      ],
      style: { head: [], border: [] },
    });

    for (const m of models) {
      table.push([
        m.name,
        formatBytes(m.size),
        m.parameterSize ?? "—",
        m.quantization ?? "—",
        m.family ?? "—",
        runningNames.has(m.name) ? chalk.green("loaded") : chalk.dim("idle"),
      ]);
    }

    console.log(table.toString());
    return { models, running, reachable: true };
  } catch (err) {
    spinner.fail("Cannot connect to Ollama");
    errorMsg("Make sure Ollama is installed and running.");
    errorMsg("  • Start it with:  ollama serve");
    errorMsg("  • Install it at:  https://ollama.com");
    if (err instanceof Error) {
      errorMsg(err.message);
    }
    if (shouldSetExitCode) process.exitCode = 1;
    return { models: [], running: [], reachable: false };
  }
}
