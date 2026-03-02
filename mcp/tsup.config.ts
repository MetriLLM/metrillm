import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Don't bundle node_modules — they'll be installed via npm
  noExternal: [/^\.\.\//, /^#cli\//],
  // Bundle CLI source files from parent directory
  external: [
    "@modelcontextprotocol/sdk",
    "zod",
    "@supabase/supabase-js",
    "chalk",
    "cli-table3",
    "commander",
    "ollama",
    "ora",
    "posthog-node",
    "systeminformation",
  ],
});
