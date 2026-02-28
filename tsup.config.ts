import { defineConfig } from "tsup";

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
});
