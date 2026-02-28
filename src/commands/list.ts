import chalk from "chalk";
import Table from "cli-table3";
import { listModels, listRunningModels } from "../core/ollama-client.js";
import { formatBytes } from "../utils.js";
import { createSpinner, errorMsg } from "../ui/progress.js";
import type { OllamaModel, OllamaRunningModel } from "../types.js";

export interface ListOptions {
  setExitCode?: boolean;
}

export interface ListOutcome {
  models: OllamaModel[];
  running: OllamaRunningModel[];
}

export async function listCommand(options: ListOptions = {}): Promise<ListOutcome> {
  const shouldSetExitCode = options.setExitCode !== false;
  const spinner = createSpinner("Fetching models from Ollama...");
  spinner.start();

  try {
    const [models, running] = await Promise.all([
      listModels(),
      listRunningModels(),
    ]);

    spinner.succeed(`Found ${models.length} model(s)`);

    if (models.length === 0) {
      console.log(chalk.yellow("\nNo models found. Pull one with: ollama pull <model>"));
      return { models, running };
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
    return { models, running };
  } catch (err) {
    spinner.fail("Failed to connect to Ollama");
    errorMsg(
      "Make sure Ollama is running: ollama serve"
    );
    if (err instanceof Error) {
      errorMsg(err.message);
    }
    if (shouldSetExitCode) process.exitCode = 1;
    return { models: [], running: [] };
  }
}
