import { abortOngoingRequests, generate } from "../core/runtime.js";
import type { CategoryResult, CodingTask, QuestionResult } from "../types.js";
import { extractCodeBlock, stripThinkTags, stripTypeAnnotations, toBenchmarkFailureLabel, withTimeout } from "../utils.js";
import { createSpinner } from "../ui/progress.js";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import codingData from "../datasets/coding.json" with { type: "json" };

const VALID_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const tasks = codingData as CodingTask[];

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a as Record<string, unknown>).sort();
    const keysB = Object.keys(b as Record<string, unknown>).sort();
    if (!deepEqual(keysA, keysB)) return false;
    return keysA.every((key) =>
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    );
  }

  return false;
}

const DIFFICULTY_WEIGHT: Record<string, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

const SANDBOX_TIMEOUT_MS = 5_000;
const ISOLATED_WALL_TIMEOUT_MIN_MS = 8_000;
const ISOLATED_WALL_TIMEOUT_MAX_MS = 60_000;
const DEFAULT_CODING_TIMEOUT_MS = 240_000;
const MAX_SANDBOX_STDOUT_BYTES = 64 * 1024;
const MAX_SANDBOX_STDERR_BYTES = 64 * 1024;

function runTestsInSandbox(
  code: string,
  task: CodingTask,
  sandboxTimeoutMs: number,
  vmModule: typeof vm
): { passed: number; total: number } {
  let passed = 0;
  const total = task.tests.length;

  const VALID_ID = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  if (!VALID_ID.test(task.functionName)) {
    return { passed: 0, total };
  }

  try {
    const noop = () => {};
    const sandbox = Object.create(null) as vm.Context & {
      console?: Record<string, () => void>;
      __testFn?: unknown;
    };
    // Prevent untrusted snippets from spamming stdout/stderr in the isolated runner.
    sandbox.console = Object.freeze({
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      trace: noop,
    });
    const context = vmModule.createContext(sandbox, {
      codeGeneration: {
        strings: false,
        wasm: false,
      },
    });

    const script = new vmModule.Script(
      `${code}\nglobalThis.__testFn = typeof ${task.functionName} === 'function' ? ${task.functionName} : undefined;`
    );
    script.runInContext(context, { timeout: sandboxTimeoutMs });

    if (typeof sandbox.__testFn !== "function") {
      return { passed: 0, total };
    }

    for (const test of task.tests) {
      try {
        const testInputJson = JSON.stringify(structuredClone(test.input));
        const testScript = new vmModule.Script(`__testFn(...${testInputJson})`);
        const result = testScript.runInContext(context, { timeout: sandboxTimeoutMs });
        if (deepEqual(result, test.expected)) {
          passed++;
        }
      } catch {
        // test failed or timed out
      }
    }
  } catch {
    // compile/run failed
  }

  return { passed, total };
}

function computeIsolatedWallTimeoutMs(task: CodingTask): number {
  const estimated = (task.tests.length + 1) * SANDBOX_TIMEOUT_MS + 1_000;
  return Math.min(
    ISOLATED_WALL_TIMEOUT_MAX_MS,
    Math.max(ISOLATED_WALL_TIMEOUT_MIN_MS, estimated)
  );
}

const CODING_ISOLATED_SOURCE = `
var __name = (fn, _name) => fn;
const deepEqual = ${deepEqual.toString()};
const runTestsInSandbox = ${runTestsInSandbox.toString()};
const vm = require("node:vm");

let payload = null;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    payload = JSON.parse(input || "{}");
    const result = runTestsInSandbox(
      typeof payload.code === "string" ? payload.code : "",
      payload.task,
      typeof payload.sandboxTimeoutMs === "number" ? payload.sandboxTimeoutMs : 5000,
      vm
    );
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    const total = Array.isArray(payload?.task?.tests) ? payload.task.tests.length : 0;
    process.stdout.write(
      JSON.stringify({
        passed: 0,
        total,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
});
`;

const CODING_WORKER_SOURCE = `
var __name = (fn, _name) => fn;
const deepEqual = ${deepEqual.toString()};
const runTestsInSandbox = ${runTestsInSandbox.toString()};
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");

try {
  const payload = runTestsInSandbox(
    workerData.code,
    workerData.task,
    workerData.sandboxTimeoutMs,
    vm
  );
  parentPort.postMessage(payload);
} catch (err) {
  const total = Array.isArray(workerData?.task?.tests) ? workerData.task.tests.length : 0;
  parentPort.postMessage({
    passed: 0,
    total,
    error: err instanceof Error ? err.message : String(err),
  });
}
`;

export function runTests(code: string, task: CodingTask): { passed: number; total: number } {
  return runTestsInSandbox(code, task, SANDBOX_TIMEOUT_MS, vm);
}

function parseIsolatedResult(
  raw: string,
  fallbackTotal: number
): { passed: number; total: number } | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { passed?: unknown; total?: unknown };
    if (typeof parsed.passed !== "number" || !Number.isFinite(parsed.passed)) return null;
    const rawTotal = typeof parsed.total === "number" && Number.isFinite(parsed.total)
      ? parsed.total
      : fallbackTotal;
    const total = Math.max(0, Math.trunc(rawTotal));
    const passed = Math.max(0, Math.min(total, Math.trunc(parsed.passed)));
    return { passed, total };
  } catch {
    return null;
  }
}

function sandboxProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const passthrough = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
  ] as const;
  for (const key of passthrough) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  env.NODE_ENV = "production";
  return env;
}

function resolveSandboxMode(): "subprocess" | "worker" {
  const raw = process.env.METRILLM_CODING_SANDBOX?.trim().toLowerCase();
  if (raw === "worker") return "worker";
  return "subprocess";
}

function allowWorkerFallback(): boolean {
  const raw = process.env.METRILLM_CODING_ALLOW_WORKER_FALLBACK?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function runTestsInSubprocess(
  code: string,
  task: CodingTask
): Promise<{ passed: number; total: number } | null> {
  const total = task.tests.length;

  return new Promise((resolve) => {
    const wallTimeoutMs = computeIsolatedWallTimeoutMs(task);
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=96",
        "--input-type=commonjs",
        "-e",
        CODING_ISOLATED_SOURCE,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: sandboxProcessEnv(),
      }
    );

    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const finish = (result: { passed: number; total: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > MAX_SANDBOX_STDOUT_BYTES) {
        child.kill("SIGKILL");
        finish(null);
        return;
      }
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrBytes += Buffer.byteLength(chunk, "utf8");
      if (stderrBytes > MAX_SANDBOX_STDERR_BYTES) {
        child.kill("SIGKILL");
        finish(null);
        return;
      }
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      // A timeout is considered a task failure (0/N), not infra failure.
      finish({ passed: 0, total });
    }, wallTimeoutMs);

    child.once("error", () => {
      finish(null);
    });

    child.once("close", (code) => {
      const parsed = parseIsolatedResult(stdout, total);
      if (parsed) {
        finish(parsed);
        return;
      }
      // Unparseable/missing payload is an infra failure, not a model failure.
      finish(null);
    });

    try {
      const payload = JSON.stringify({
        code,
        task,
        sandboxTimeoutMs: SANDBOX_TIMEOUT_MS,
      });
      child.stdin.write(payload);
      child.stdin.end();
    } catch {
      child.kill("SIGKILL");
      finish(null);
    }
  });
}

async function runTestsInWorker(
  code: string,
  task: CodingTask
): Promise<{ passed: number; total: number }> {
  const total = task.tests.length;

  return new Promise((resolve) => {
    const wallTimeoutMs = computeIsolatedWallTimeoutMs(task);
    const worker = new Worker(CODING_WORKER_SOURCE, {
      eval: true,
      workerData: {
        code,
        task,
        sandboxTimeoutMs: SANDBOX_TIMEOUT_MS,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });

    let settled = false;
    const finish = (result: { passed: number; total: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      resolve(result);
    };

    const timer = setTimeout(() => {
      void worker.terminate().finally(() => {
        finish({ passed: 0, total });
      });
    }, wallTimeoutMs);

    worker.once("message", (msg: unknown) => {
      const passed = typeof (msg as { passed?: unknown })?.passed === "number"
        ? (msg as { passed: number }).passed
        : 0;
      const reportedTotal = typeof (msg as { total?: unknown })?.total === "number"
        ? (msg as { total: number }).total
        : total;
      finish({ passed, total: reportedTotal });
      void worker.terminate();
    });

    worker.once("error", () => {
      finish({ passed: 0, total });
    });

    worker.once("exit", () => {
      if (!settled) {
        finish({ passed: 0, total });
      }
    });
  });
}

async function runTestsIsolated(
  code: string,
  task: CodingTask
): Promise<{ passed: number; total: number }> {
  const total = task.tests.length;
  if (resolveSandboxMode() === "worker") {
    return runTestsInWorker(code, task);
  }

  const firstAttempt = await runTestsInSubprocess(code, task);
  if (firstAttempt) return firstAttempt;

  // Retry once to reduce random infra flakiness (process bootstrap noise).
  const secondAttempt = await runTestsInSubprocess(code, task);
  if (secondAttempt) return secondAttempt;

  // Security-first default: avoid silently downgrading to a weaker isolation model.
  if (allowWorkerFallback()) {
    return runTestsInWorker(code, task);
  }
  throw new Error(
    "Coding sandbox infrastructure failure (set METRILLM_CODING_ALLOW_WORKER_FALLBACK=true to allow worker fallback)"
  );
}

export async function runCodingBench(
  model: string,
  opts?: { think?: boolean; timeoutMs?: number }
): Promise<CategoryResult> {
  const spinner = createSpinner("Running coding benchmark...");
  spinner.start();

  const details: QuestionResult[] = [];
  let totalPassed = 0;
  let totalTests = 0;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_CODING_TIMEOUT_MS;

  try {
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (!VALID_IDENTIFIER_RE.test(task.functionName)) {
        details.push({
          id: task.id,
          question: task.description,
          expected: `${task.tests.length} tests pass`,
          actual: "ERROR: invalid function name in dataset",
          correct: false,
          timeMs: 0,
        });
        totalTests += task.tests.length;
        continue;
      }
      spinner.text = `Coding ${i + 1}/${tasks.length}: ${task.functionName}`;

      const prompt = `Write a JavaScript function with the following signature:
${task.signature}

${task.description}

Reply with ONLY the function code, no explanation.`;

      const startTime = Date.now();
      try {
        const result = await withTimeout(
          generate(model, prompt, { temperature: 0, num_predict: 2048, think: opts?.think }),
          timeoutMs,
          "Coding task",
          abortOngoingRequests
        );

        const rawCode = extractCodeBlock(stripThinkTags(result.response), task.functionName);
        const code = stripTypeAnnotations(rawCode);
        const { passed, total } = await runTestsIsolated(code, task);
        totalPassed += passed;
        totalTests += total;

        const allPassed = passed === total;

        details.push({
          id: task.id,
          question: task.description,
          expected: `${total} tests pass`,
          actual: `${passed}/${total} tests pass`,
          correct: allPassed,
          timeMs: Date.now() - startTime,
        });
      } catch (err) {
        totalTests += task.tests.length;
        details.push({
          id: task.id,
          question: task.description,
          expected: `${task.tests.length} tests pass`,
          actual: toBenchmarkFailureLabel(err),
          correct: false,
          timeMs: Date.now() - startTime,
        });
      }
    }

    spinner.succeed(`Coding: ${details.filter((d) => d.correct).length}/${tasks.length} tasks fully passed`);
  } catch (err) {
    spinner.fail("Coding benchmark failed");
    throw err;
  }

  // Difficulty-weighted, all-or-nothing scoring: a task scores its weight
  // only when ALL its tests pass. Easy tasks count less than hard ones.
  let weightedPassed = 0;
  let weightedTotal = 0;
  for (let i = 0; i < tasks.length; i++) {
    const w = DIFFICULTY_WEIGHT[tasks[i].difficulty ?? "medium"] ?? 2;
    weightedTotal += w;
    if (details[i].correct) {
      weightedPassed += w;
    }
  }

  const tasksPassed = details.filter((d) => d.correct).length;
  return {
    score: weightedTotal > 0 ? (weightedPassed / weightedTotal) * 100 : 0,
    correct: tasksPassed,
    total: tasks.length,
    details,
  };
}
