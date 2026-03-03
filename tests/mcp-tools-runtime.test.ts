/**
 * Test intent:
 * - Verify MCP tool handlers correctly support and forward the lm-studio runtime.
 *
 * Why it matters:
 * - MCP users must be able to benchmark and list models on LM Studio, not only Ollama.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listModelsMock,
  setRuntimeByNameMock,
  getRuntimeDisplayNameMock,
  getRuntimeModelInstallHintMock,
  benchCommandMock,
} = vi.hoisted(() => ({
  listModelsMock: vi.fn(),
  setRuntimeByNameMock: vi.fn(),
  getRuntimeDisplayNameMock: vi.fn(),
  getRuntimeModelInstallHintMock: vi.fn(),
  benchCommandMock: vi.fn(),
}));

vi.mock("../src/core/runtime.js", () => ({
  listModels: listModelsMock,
  setRuntimeByName: setRuntimeByNameMock,
  getRuntimeDisplayName: getRuntimeDisplayNameMock,
  getRuntimeModelInstallHint: getRuntimeModelInstallHintMock,
}));

vi.mock("../src/commands/bench.js", () => ({
  benchCommand: benchCommandMock,
}));

describe("mcp tools runtime support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRuntimeDisplayNameMock.mockReturnValue("LM Studio");
    getRuntimeModelInstallHintMock.mockReturnValue(
      "Download/select a model in LM Studio, then load it in the local server."
    );
  });

  it("accepts lm-studio in schemas and lists models on that runtime", async () => {
    listModelsMock.mockResolvedValueOnce([
      {
        name: "qwen3-8b",
        size: 0,
        parameterSize: undefined,
        quantization: undefined,
        family: undefined,
      },
    ]);

    const { listModelsSchema, handleListModels } = await import("../mcp/src/tools.js");
    const parsed = listModelsSchema.parse({ runtime: "lm-studio" });
    const output = await handleListModels(parsed);
    const body = JSON.parse(output) as {
      count: number;
      models: Array<{ name: string; size: number }>;
    };

    expect(setRuntimeByNameMock).toHaveBeenCalledWith("lm-studio");
    expect(listModelsMock).toHaveBeenCalledTimes(1);
    expect(body.count).toBe(1);
    expect(body.models[0]).toMatchObject({ name: "qwen3-8b", size: 0 });
  });

  it("returns a runtime-specific hint when no models are available", async () => {
    listModelsMock.mockResolvedValueOnce([]);

    const { handleListModels } = await import("../mcp/src/tools.js");
    const output = await handleListModels({ runtime: "lm-studio" });
    const body = JSON.parse(output) as { models: unknown[]; message: string };

    expect(body.models).toEqual([]);
    expect(body.message).toContain("No models found on LM Studio");
    expect(body.message).toContain("Download/select a model in LM Studio");
  });

  it("forwards lm-studio backend to benchCommand", async () => {
    benchCommandMock.mockResolvedValueOnce({
      failedModels: [],
      results: [
        {
          model: "qwen3-8b",
          performance: { tokensPerSecond: 42, ttft: 120, memoryUsedGB: 8, memoryPercent: 35 },
          fitness: {
            verdict: "GOOD",
            globalScore: 77,
            performanceScore: { total: 75, speed: 30, ttft: 25, memory: 20 },
            qualityScore: { total: 79 },
            interpretation: "ok",
          },
        },
      ],
    });

    const { runBenchmarkSchema, handleRunBenchmark } = await import("../mcp/src/tools.js");
    const parsed = runBenchmarkSchema.parse({
      model: "qwen3-8b",
      runtime: "lm-studio",
      perfOnly: false,
    });
    const output = await handleRunBenchmark(parsed);
    const body = JSON.parse(output) as { success: boolean; model: string; verdict: string };

    expect(setRuntimeByNameMock).toHaveBeenCalledWith("lm-studio");
    expect(benchCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "qwen3-8b",
        backend: "lm-studio",
        perfOnly: false,
        json: true,
        share: false,
        setExitCode: false,
      })
    );
    expect(body).toMatchObject({
      success: true,
      model: "qwen3-8b",
      verdict: "GOOD",
    });
  });
});
