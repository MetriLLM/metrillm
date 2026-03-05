import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

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
    return { latest: parsed.latest, checkedAt: parsed.checkedAt };
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

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const cache = await readCache();
    if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
      return {
        current: currentVersion,
        latest: cache.latest,
        updateAvailable: compareSemver(cache.latest, currentVersion) > 0,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let latest: string;
    try {
      const response = await fetch("https://registry.npmjs.org/metrillm/latest", {
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = (await response.json()) as Record<string, unknown>;
      if (typeof data.version !== "string") return null;
      latest = data.version;
    } finally {
      clearTimeout(timeout);
    }

    await writeCache({ latest, checkedAt: Date.now() });

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
    execSync("npm install -g metrillm@latest", { stdio: "inherit", timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}
