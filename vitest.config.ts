import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".js", ".mjs"],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 48,
        branches: 43,
        functions: 57,
        statements: 47,
      },
      include: ["src/**/*.ts"],
      exclude: ["src/datasets/**", "src/**/*.d.ts"],
    },
  },
});
