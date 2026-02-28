/**
 * Test intent:
 * - Guard against VM escape via host-object injection in coding benchmark execution.
 * - Keep coding benchmark inputs immutable across runs for deterministic scoring.
 *
 * Why it matters:
 * - A VM escape would allow arbitrary host execution from model-generated code.
 * - Mutable shared inputs make model comparisons order-dependent and unreliable.
 */
import { describe, it, expect } from "vitest";
import type { CodingTask } from "../src/types.js";
import { runTests } from "../src/benchmarks/coding.js";

describe("coding benchmark sandbox regressions", () => {
  it("does not allow constructor escape through test inputs", () => {
    const task: CodingTask = {
      id: 9991,
      description: "regression: sandbox escape through injected input",
      functionName: "probe",
      signature: "function probe(input)",
      tests: [
        {
          input: [{ safe: true }],
          expected: "blocked",
        },
      ],
    };

    const code = `function probe(input) {
      try {
        input.constructor.constructor("return process")();
        return "escaped";
      } catch {
        return "blocked";
      }
    }`;

    const result = runTests(code, task);
    expect(result).toEqual({ passed: 1, total: 1 });
  });

  it("keeps task inputs stable across repeated evaluations", () => {
    const task: CodingTask = {
      id: 9992,
      description: "regression: shared mutable input between runs",
      functionName: "mutate",
      signature: "function mutate(arr)",
      tests: [
        {
          input: [[1, 2]],
          expected: true,
        },
      ],
    };

    const code = `function mutate(arr) {
      arr.push(0);
      return arr.length === 3;
    }`;

    const first = runTests(code, task);
    const second = runTests(code, task);

    expect(first).toEqual({ passed: 1, total: 1 });
    expect(second).toEqual({ passed: 1, total: 1 });
    expect(task.tests[0].input).toEqual([[1, 2]]);
  });

  it("is robust when model code tampers with sandbox JSON.parse", () => {
    const task: CodingTask = {
      id: 9993,
      description: "regression: avoid JSON.parse dependency in benchmark harness",
      functionName: "add",
      signature: "function add(a, b)",
      tests: [
        { input: [2, 3], expected: 5 },
        { input: [10, -4], expected: 6 },
      ],
    };

    const code = `JSON.parse = () => { throw new Error("poisoned"); };
function add(a, b) { return a + b; }`;

    const result = runTests(code, task);
    expect(result).toEqual({ passed: 2, total: 2 });
  });
});
