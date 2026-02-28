import { defineConfig } from "vitest/config";

export default defineConfig({
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
      exclude: ["src/datasets/**"],
    },
  },
});
