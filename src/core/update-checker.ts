import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { getInstallChannel, type InstallChannel } from "./app-meta.js";

const BASE_DIR = join(homedir(), ".metrillm");
const CACHE_PATH = join(BASE_DIR, "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

interface UpdateCache {
  latest: string;
  checkedAt: number;
  channel?: InstallChannel;
}

export function getInstallChannelLabel(channel: InstallChannel = getInstallChannel()): string {
  if (channel === "homebrew") return "Homebrew";
  if (channel === "npm") return "npm";
  return "local checkout";
}

export function getUpdateCommand(channel: InstallChannel = getInstallChannel()): string {
  if (channel === "homebrew") return "brew upgrade metrillm";
  return "npm install -g metrillm@latest";
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function readCache(): Promise<UpdateCache | null> {
  try {
    const content = await readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.latest !== "string" || typeof parsed.checkedAt !== "number") {
      return null;
    }
    const channel = parsed.channel;
    if (
      channel !== undefined &&
      channel !== "homebrew" &&
      channel !== "npm" &&
      channel !== "local"
    ) {
      return null;
    }
    return {
      latest: parsed.latest,
      checkedAt: parsed.checkedAt,
      channel: channel as InstallChannel | undefined,
    };
  } catch {
    return null;
  }
}

async function writeCache(cache: UpdateCache): Promise<void> {
  try {
    await mkdir(BASE_DIR, { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // Best-effort — ignore write errors.
  }
}

async function fetchLatestFromNpm(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch("https://registry.npmjs.org/metrillm/latest", {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.version !== "string") return null;
    return data.version;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function fetchLatestFromHomebrew(): string | null {
  try {
    const raw = execSync("brew info --json=v2 metrillm", {
      encoding: "utf8",
      timeout: FETCH_TIMEOUT_MS,
    }) as string;
    const parsed = JSON.parse(raw) as {
      formulae?: Array<{ versions?: { stable?: unknown } }>;
    };
    const stable = parsed.formulae?.[0]?.versions?.stable;
    if (typeof stable !== "string" || stable.length === 0) {
      return null;
    }
    return stable;
  } catch {
    return null;
  }
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const channel = getInstallChannel();
    const cache = await readCache();
    if (
      cache &&
      Date.now() - cache.checkedAt < CACHE_TTL_MS &&
      cache.channel === channel
    ) {
      return {
        current: currentVersion,
        latest: cache.latest,
        updateAvailable: compareSemver(cache.latest, currentVersion) > 0,
      };
    }

    const latest = channel === "homebrew"
      ? fetchLatestFromHomebrew()
      : await fetchLatestFromNpm();
    if (!latest) return null;

    await writeCache({ latest, checkedAt: Date.now(), channel });

    return {
      current: currentVersion,
      latest,
      updateAvailable: compareSemver(latest, currentVersion) > 0,
    };
  } catch {
    return null;
  }
}

export function runUpdate(): boolean {
  try {
    execSync(getUpdateCommand(), { stdio: "inherit", timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}
