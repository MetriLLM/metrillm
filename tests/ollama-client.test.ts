import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateMock,
  abortMock,
} = vi.hoisted(() => ({
  generateMock: vi.fn(),
  abortMock: vi.fn(),
}));

vi.mock("ollama", () => {
  return {
    Ollama: class MockOllama {
    generate = generateMock;
    list = vi.fn(async () => ({ models: [] }));
    ps = vi.fn(async () => ({ models: [] }));
    abort = abortMock;
    },
  };
});

async function* makeStreamChunks(): AsyncGenerator<Record<string, unknown>> {
  yield { response: "OK", done: false };
  yield {
    done: true,
    total_duration: 1,
    load_duration: 0,
    prompt_eval_count: 1,
    prompt_eval_duration: 1,
    eval_count: 1,
    eval_duration: 1,
  };
}

describe("ollama-client sampling fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("retries without top_p/seed when backend rejects sampling options", async () => {
    generateMock
      .mockRejectedValueOnce(new Error("unknown option: seed"))
      .mockResolvedValueOnce(makeStreamChunks());

    const client = await import("../src/core/ollama-client.js");
    const result = await client.generateStream("model-a", "prompt", undefined, { top_p: 1, seed: 42 });

    expect(result.response).toBe("OK");
    expect(generateMock).toHaveBeenCalledTimes(2);

    const firstCall = generateMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const secondCall = generateMock.mock.calls[1]?.[0] as Record<string, unknown>;
    expect((firstCall.options as Record<string, unknown>)?.top_p).toBe(1);
    expect((firstCall.options as Record<string, unknown>)?.seed).toBe(42);
    expect((secondCall.options as Record<string, unknown>)?.top_p).toBeUndefined();
    expect((secondCall.options as Record<string, unknown>)?.seed).toBeUndefined();
  });

  it("applies per-request stream stall timeout override", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      generateMock.mockResolvedValueOnce(makeStreamChunks());

      const client = await import("../src/core/ollama-client.js");
      await client.generateStream("model-a", "prompt", undefined, { stall_timeout_ms: 1234 });

      expect(
        setTimeoutSpy.mock.calls.some((call) => call[1] === 1234)
      ).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
