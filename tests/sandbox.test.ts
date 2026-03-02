/**
 * Test intent:
 * - Validate isolation guarantees of the VM sandbox used for coding benchmarks.
 * - Confirm that untrusted code cannot access Node runtime primitives.
 *
 * Why it matters:
 * - This is a security boundary: failures here can expose host data or process state.
 * - It also protects benchmark reliability by containing malicious or buggy model outputs.
 */
import { describe, it, expect } from "vitest";
import vm from "node:vm";

// Replicate the sandbox setup from coding.ts to test isolation
function createSandbox() {
  const sandbox = Object.create(null) as vm.Context;
  return vm.createContext(sandbox, {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  });
}

describe("coding sandbox isolation", () => {
  it("runs basic code correctly", () => {
    const context = createSandbox();
    const script = new vm.Script("function add(a, b) { return a + b; }\nadd;");
    const fn = script.runInContext(context, { timeout: 5000 });
    expect(fn(2, 3)).toBe(5);
  });

  it("blocks access to require", () => {
    const context = createSandbox();
    const script = new vm.Script("typeof require");
    const result = script.runInContext(context, { timeout: 5000 });
    expect(result).toBe("undefined");
  });

  it("blocks access to process", () => {
    const context = createSandbox();
    const script = new vm.Script("typeof process");
    const result = script.runInContext(context, { timeout: 5000 });
    expect(result).toBe("undefined");
  });

  it("blocks access to global/globalThis (no Node APIs)", () => {
    const context = createSandbox();
    // globalThis exists in sandbox but has no Node APIs
    const script = new vm.Script("typeof globalThis.require");
    const result = script.runInContext(context, { timeout: 5000 });
    expect(result).toBe("undefined");
  });

  it("blocks access to import/module", () => {
    const context = createSandbox();
    const script = new vm.Script("typeof module");
    const result = script.runInContext(context, { timeout: 5000 });
    expect(result).toBe("undefined");
  });

  it("blocks access to __dirname and __filename", () => {
    const context = createSandbox();
    const script = new vm.Script("typeof __dirname + '/' + typeof __filename");
    const result = script.runInContext(context, { timeout: 5000 });
    expect(result).toBe("undefined/undefined");
  });

  it("blocks constructor constructor escape to process", () => {
    const context = createSandbox();
    const script = new vm.Script("Array.constructor.constructor('return process')()");
    expect(() => script.runInContext(context, { timeout: 5000 })).toThrow(
      /Code generation from strings disallowed/
    );
  });

  it("does not pollute host prototypes", () => {
    const context = createSandbox();
    const script = new vm.Script("Array.prototype.__metrillmProbe = 123");
    script.runInContext(context, { timeout: 5000 });
    expect(([] as unknown[] & { __metrillmProbe?: number }).__metrillmProbe).toBeUndefined();
  });

  it("times out on infinite loops", () => {
    const context = createSandbox();
    const script = new vm.Script("while(true) {}");
    expect(() => script.runInContext(context, { timeout: 100 })).toThrow();
  });

  it("allows Math operations", () => {
    const context = createSandbox();
    const script = new vm.Script("Math.max(1, 2, 3)");
    const result = script.runInContext(context, { timeout: 5000 });
    expect(result).toBe(3);
  });

  it("allows Array operations", () => {
    const context = createSandbox();
    const script = new vm.Script("[1,2,3].map(x => x * 2)");
    const result = script.runInContext(context, { timeout: 5000 });
    expect(result).toEqual([2, 4, 6]);
  });

  it("allows JSON operations", () => {
    const context = createSandbox();
    const script = new vm.Script('JSON.parse(\'{"a":1}\')');
    const result = script.runInContext(context, { timeout: 5000 });
    expect(result).toEqual({ a: 1 });
  });
});
