import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BenchResult } from "../types.js";
import { normalizeEmail, normalizeNickname, isValidEmail, isValidNickname } from "./submitter.js";

const BASE_DIR = join(homedir(), ".llmeter");
const RESULTS_DIR = join(BASE_DIR, "results");
const CONFIG_PATH = join(BASE_DIR, "config.json");

export interface LLMeterConfig {
  autoShare: true | "ask"; // true = always share, "ask" = prompt every run
  telemetry?: boolean;        // true = opt-in, false = opt-out, undefined = not yet decided
  submitterNickname?: string;
  submitterEmail?: string;
}

const DEFAULT_CONFIG: LLMeterConfig = {
  autoShare: "ask",
};

async function ensureDirs(): Promise<void> {
  await mkdir(RESULTS_DIR, { recursive: true });
}

function resultFilename(result: BenchResult): string {
  const ts = result.timestamp
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace(/[^0-9_-]/g, "");
  const model = result.model.replace(/[^a-zA-Z0-9._-]/g, "_");
  const hashSuffix = result.metadata.rawLogHash
    ? result.metadata.rawLogHash.slice(0, 8)
    : `${Date.now()}`;
  return `${ts}_${model}_${hashSuffix}.json`;
}

export async function saveResult(result: BenchResult): Promise<string> {
  await ensureDirs();
  const filename = resultFilename(result);
  const filepath = join(RESULTS_DIR, filename);
  await writeFile(filepath, JSON.stringify(result, null, 2), "utf8");
  return filepath;
}

export async function loadResults(): Promise<BenchResult[]> {
  await ensureDirs();
  try {
    const files = await readdir(RESULTS_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
    const results: BenchResult[] = [];
    for (const file of jsonFiles) {
      try {
        const content = await readFile(join(RESULTS_DIR, file), "utf8");
        results.push(JSON.parse(content) as BenchResult);
      } catch {
        // Skip malformed files
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function loadConfig(): Promise<LLMeterConfig> {
  try {
    const content = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const autoShare = parsed.autoShare === true ? true : "ask";
    const telemetry = typeof parsed.telemetry === "boolean" ? parsed.telemetry : undefined;
    const submitterNickname = typeof parsed.submitterNickname === "string"
      && isValidNickname(parsed.submitterNickname)
      ? normalizeNickname(parsed.submitterNickname)
      : undefined;
    const submitterEmail = typeof parsed.submitterEmail === "string"
      && isValidEmail(parsed.submitterEmail)
      ? normalizeEmail(parsed.submitterEmail)
      : undefined;
    return { ...DEFAULT_CONFIG, autoShare, telemetry, submitterNickname, submitterEmail };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: LLMeterConfig): Promise<void> {
  await ensureDirs();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export function getResultsDir(): string {
  return RESULTS_DIR;
}
