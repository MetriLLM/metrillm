/**
 * Test intent:
 * - Validate formatting helpers used for CLI progress/status messages.
 *
 * Why it matters:
 * - These helpers are used everywhere in command output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSpinner,
  errorMsg,
  stepHeader,
  subStep,
  successMsg,
  warnMsg,
} from "../src/ui/progress.js";

describe("progress helpers", () => {
  let output: string[] = [];

  beforeEach(() => {
    output = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a spinner with expected defaults", () => {
    const spinner = createSpinner("Loading...");
    expect(spinner).toBeDefined();
    expect(spinner.text).toContain("Loading");
  });

  it("prints all message variants", () => {
    stepHeader("Benchmark");
    subStep("sub");
    successMsg("ok");
    warnMsg("careful");
    errorMsg("failed");

    const joined = output.join("\n");
    expect(joined).toContain("Benchmark");
    expect(joined).toContain("sub");
    expect(joined).toContain("ok");
    expect(joined).toContain("careful");
    expect(joined).toContain("failed");
  });
});
