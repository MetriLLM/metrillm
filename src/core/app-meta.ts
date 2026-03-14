import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageJsonShape {
  version?: string;
}

export type InstallChannel = "homebrew" | "npm" | "local";

let cachedVersion: string | null = null;

function resolveExecutablePath(path: string | undefined): string | null {
  if (!path) return null;

  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function getPackageJsonCandidates(): string[] {
  const candidates = new Set<string>();
  const executablePath = resolveExecutablePath(process.argv[1]);
  if (executablePath) {
    const executableDir = dirname(executablePath);
    candidates.add(resolve(executableDir, "../package.json"));
    candidates.add(resolve(executableDir, "package.json"));
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  candidates.add(resolve(moduleDir, "../package.json"));
  candidates.add(resolve(moduleDir, "../../package.json"));
  candidates.add(resolve(process.cwd(), "package.json"));
  return [...candidates];
}

export function detectInstallChannel(path: string): InstallChannel {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/cellar/metrillm/")) return "homebrew";
  if (normalized.includes("/node_modules/metrillm/")) return "npm";
  return "local";
}

export function getInstallChannel(): InstallChannel {
  const scriptPath = process.argv[1];
  if (!scriptPath) return "local";

  try {
    return detectInstallChannel(realpathSync(scriptPath));
  } catch {
    return detectInstallChannel(scriptPath);
  }
}

export function getCliVersion(): string {
  if (cachedVersion) return cachedVersion;

  for (const path of getPackageJsonCandidates()) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as PackageJsonShape;
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        cachedVersion = parsed.version;
        return cachedVersion;
      }
    } catch {
      // Try the next candidate path.
    }
  }

  cachedVersion = "0.0.0";
  return cachedVersion;
}
