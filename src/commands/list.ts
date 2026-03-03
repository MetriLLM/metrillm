import chalk from "chalk";
import Table from "cli-table3";
import {
  listModels,
  listRunningModels,
  getRuntimeDisplayName,
  getRuntimeModelInstallHint,
  getRuntimeSetupHints,
  getRuntimeName,
  setRuntimeByName,
} from "../core/runtime.js";
import { formatBytes } from "../utils.js";
import { createSpinner, errorMsg, warnMsg } from "../ui/progress.js";
import type { OllamaModel, OllamaRunningModel } from "../types.js";

export interface ListOptions {
  setExitCode?: boolean;
  backend?: string;
}

export interface ListOutcome {
  models: OllamaModel[];
  running: OllamaRunningModel[];
  reachable: boolean;
}

export async function listCommand(options: ListOptions = {}): Promise<ListOutcome> {
  if (options.backend !== undefined) {
    setRuntimeByName(options.backend);
  }
  const runtimeName = getRuntimeName();
  const runtimeDisplayName = getRuntimeDisplayName(runtimeName);
  const runtimeModelHint = getRuntimeModelInstallHint(runtimeName);
  const runtimeSetupHints = getRuntimeSetupHints(runtimeName);

  const shouldSetExitCode = options.setExitCode !== false;
  const spinner = createSpinner(`Fetching models from ${runtimeDisplayName}...`);
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
      console.log(chalk.yellow(`\nNo models found. ${runtimeModelHint}`));
      return { models, running, reachable: true };
    }

    const runningNames = new Set(running.map((r) => r.name));
    const formatStatus = (model: OllamaModel): string => {
      const normalizedStatus = model.runtimeStatus?.trim().toLowerCase();
      if (normalizedStatus) {
        if (normalizedStatus.includes("not-loaded")) return chalk.dim("not-loaded");
        if (normalizedStatus.includes("loaded")) return chalk.green("loaded");
        if (normalizedStatus.includes("loading")) return chalk.yellow(model.runtimeStatus ?? "loading");
        if (normalizedStatus.includes("error") || normalizedStatus.includes("failed")) {
          return chalk.red(model.runtimeStatus ?? "error");
        }
        return chalk.dim(model.runtimeStatus ?? "idle");
      }
      return runningNames.has(model.name) ? chalk.green("loaded") : chalk.dim("idle");
    };

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
        m.size > 0 ? formatBytes(m.size) : "—",
        m.parameterSize ?? "—",
        m.quantization ?? "—",
        m.family ?? "—",
        formatStatus(m),
      ]);
    }

    console.log(table.toString());
    return { models, running, reachable: true };
  } catch (err) {
    spinner.fail(`Cannot connect to ${runtimeDisplayName}`);
    errorMsg(`Make sure ${runtimeDisplayName} is installed and running.`);
    for (const hint of runtimeSetupHints) {
      errorMsg(`  • ${hint}`);
    }
    if (err instanceof Error) {
      errorMsg(err.message);
    }
    if (shouldSetExitCode) process.exitCode = 1;
    return { models: [], running: [], reachable: false };
  }
}
