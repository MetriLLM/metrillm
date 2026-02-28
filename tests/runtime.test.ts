import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateMock,
  generateStreamMock,
  listModelsMock,
  listRunningModelsMock,
  getOllamaVersionMock,
  abortOngoingRequestsMock,
} = vi.hoisted(() => ({
  generateMock: vi.fn(),
  generateStreamMock: vi.fn(),
  listModelsMock: vi.fn(),
  listRunningModelsMock: vi.fn(),
  getOllamaVersionMock: vi.fn(),
  abortOngoingRequestsMock: vi.fn(),
}));

vi.mock("../src/core/ollama-client.js", () => ({
  generate: generateMock,
  generateStream: generateStreamMock,
  listModels: listModelsMock,
  listRunningModels: listRunningModelsMock,
  getOllamaVersion: getOllamaVersionMock,
  abortOngoingRequests: abortOngoingRequestsMock,
}));

describe("runtime proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses default Ollama runtime through proxy exports", async () => {
    generateMock.mockResolvedValueOnce({ response: "ok" });
    generateStreamMock.mockResolvedValueOnce({ response: "ok" });
    listModelsMock.mockResolvedValueOnce([{ name: "qwen2.5:7b" }]);
    listRunningModelsMock.mockResolvedValueOnce([{ name: "qwen2.5:7b" }]);
    getOllamaVersionMock.mockResolvedValueOnce("0.5.12");

    const runtime = await import("../src/core/runtime.js");
    expect(runtime.getRuntime().name).toBe("ollama");

    await runtime.generate("m", "p");
    await runtime.generateStream("m", "p");
    await runtime.listModels();
    await runtime.listRunningModels();
    await runtime.getRuntimeVersion();
    runtime.abortOngoingRequests();

    expect(generateMock).toHaveBeenCalled();
    expect(generateStreamMock).toHaveBeenCalled();
    expect(listModelsMock).toHaveBeenCalled();
    expect(listRunningModelsMock).toHaveBeenCalled();
    expect(getOllamaVersionMock).toHaveBeenCalled();
    expect(abortOngoingRequestsMock).toHaveBeenCalled();
  });

  it("supports runtime override via setRuntime", async () => {
    const runtime = await import("../src/core/runtime.js");

    const custom = {
      name: "custom",
      generate: vi.fn(async () => ({ response: "c1" })),
      generateStream: vi.fn(async () => ({ response: "c2" })),
      listModels: vi.fn(async () => [{ name: "x" }]),
      listRunningModels: vi.fn(async () => [{ name: "x" }]),
      getVersion: vi.fn(async () => "1.0.0"),
      abort: vi.fn(),
    };

    runtime.setRuntime(custom);
    expect(runtime.getRuntime().name).toBe("custom");

    await runtime.generate("m", "p");
    await runtime.generateStream("m", "p");
    await runtime.listModels();
    await runtime.listRunningModels();
    await runtime.getRuntimeVersion();
    runtime.abortOngoingRequests();

    expect(custom.generate).toHaveBeenCalled();
    expect(custom.generateStream).toHaveBeenCalled();
    expect(custom.listModels).toHaveBeenCalled();
    expect(custom.listRunningModels).toHaveBeenCalled();
    expect(custom.getVersion).toHaveBeenCalled();
    expect(custom.abort).toHaveBeenCalled();
  });
});

