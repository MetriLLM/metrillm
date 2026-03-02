import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

function loadEnvKey(key: string): string {
  try {
    const env = readFileSync(".env", "utf-8");
    const match = env.match(new RegExp(`^${key}=(.+)$`, "m"));
    const value = match?.[1]?.trim();
    if (value) return value;
  } catch {
    // .env not found — fall through to process.env
  }
  return process.env[key] ?? "";
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  splitting: false,
  clean: true,
  target: "node20",
  platform: "node",
  banner: {
    js: '#!/usr/bin/env node\nimport{createRequire}from"module";const require=createRequire(import.meta.url);',
  },
  outExtension: () => ({ js: ".mjs" }),
  noExternal: [/(.*)/],
  treeshake: true,
  define: {
    "process.env.METRILLM_POSTHOG_KEY": JSON.stringify(
      loadEnvKey("METRILLM_POSTHOG_KEY")
    ),
  },
});
