import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadLocalEnvFile(): void {
  const withLoadEnvFile = process as NodeJS.Process & {
    loadEnvFile?: (path?: string) => void;
  };
  if (typeof withLoadEnvFile.loadEnvFile === "function") {
    try {
      withLoadEnvFile.loadEnvFile();
      return;
    } catch {
      // Fallback parser below.
    }
  }

  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      const quoted =
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"));
      process.env[key] = quoted ? rawValue.slice(1, -1) : rawValue;
    }
  } catch {
    // Ignore invalid or missing .env; regular process.env still applies.
  }
}

loadLocalEnvFile();

if (process.env.NO_COLOR !== undefined) {
  process.env.FORCE_COLOR = "0";
}

await import("./cli-main.js");
