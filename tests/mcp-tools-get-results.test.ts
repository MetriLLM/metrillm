/**
 * Test intent:
 * - Ensure MCP get_results respects the selected runtime backend.
 *
 * Why it matters:
 * - Mixed-runtime result directories must not leak rows from another backend.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readdirMock,
  readFileMock,
} = vi.hoisted(() => ({
  readdirMock: vi.fn(),
  readFileMock: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/mock-home",
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  readdir: readdirMock,
}));

vi.mock("../src/core/runtime.js", () => ({
  listModels: vi.fn(),
  getRuntimeDisplayName: vi.fn(() => "Mock Runtime"),
  getRuntimeModelInstallHint: vi.fn(() => "hint"),
  setRuntimeByName: vi.fn(),
}));

vi.mock("../src/commands/bench.js", () => ({
  benchCommand: vi.fn(),
}));

vi.mock("../src/core/uploader.js", () => ({
  uploadBenchResult: vi.fn(),
}));

function makeResult(params: {
  model: string;
  runtimeBackend?: "ollama" | "lm-studio";
  timestamp?: string;
}): string {
  return JSON.stringify({
    model: params.model,
    modelInfo: {},
    hardware: {},
    performance: { tokensPerSecond: 10 },
    quality: null,
    fitness: { verdict: "GOOD", globalScore: 70 },
    timestamp: params.timestamp ?? "2026-01-01T00:00:00.000Z",
    metadata: {
      benchmarkSpecVersion: "0.2.0",
      promptPackVersion: "0.1.0",
      runtimeVersion: "unknown",
      ...(params.runtimeBackend ? { runtimeBackend: params.runtimeBackend } : {}),
      modelFormat: "gguf",
      rawLogHash: "abc",
    },
  });
}

describe("mcp get_results runtime filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only rows matching the selected runtime, with legacy fallback to ollama", async () => {
    readdirMock.mockResolvedValue(["ollama.json", "lm.json", "legacy.json"]);
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/ollama.json")) return makeResult({ model: "llama3.2:3b", runtimeBackend: "ollama" });
      if (path.endsWith("/lm.json")) return makeResult({ model: "qwen3-8b", runtimeBackend: "lm-studio" });
      if (path.endsWith("/legacy.json")) return makeResult({ model: "legacy-ollama" });
      throw new Error("unexpected path");
    });

    const { handleGetResults } = await import("../mcp/src/tools.js");

    const lmOutput = await handleGetResults({ runtime: "lm-studio" });
    const lmBody = JSON.parse(lmOutput) as { count: number; results: Array<{ model: string }> };
    expect(lmBody.count).toBe(1);
    expect(lmBody.results.map((r) => r.model)).toEqual(["qwen3-8b"]);

    const ollamaOutput = await handleGetResults({ runtime: "ollama" });
    const ollamaBody = JSON.parse(ollamaOutput) as { count: number; results: Array<{ model: string }> };
    expect(ollamaBody.count).toBe(2);
    expect(ollamaBody.results.map((r) => r.model).sort()).toEqual(["legacy-ollama", "llama3.2:3b"]);
  });
});
