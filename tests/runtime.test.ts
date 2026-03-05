import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateMock,
  generateStreamMock,
  listModelsMock,
  listRunningModelsMock,
  getOllamaVersionMock,
  unloadModelMock,
  setDefaultKeepAliveMock,
  abortOngoingRequestsMock,
  lmStudioGenerateMock,
  lmStudioGenerateStreamMock,
  lmStudioListModelsMock,
  lmStudioResolveModelMock,
  lmStudioListRunningModelsMock,
  getLMStudioVersionMock,
  lmStudioUnloadModelMock,
  lmStudioSetDefaultKeepAliveMock,
  lmStudioAbortOngoingRequestsMock,
} = vi.hoisted(() => ({
  generateMock: vi.fn(),
  generateStreamMock: vi.fn(),
  listModelsMock: vi.fn(),
  listRunningModelsMock: vi.fn(),
  getOllamaVersionMock: vi.fn(),
  unloadModelMock: vi.fn(),
  setDefaultKeepAliveMock: vi.fn(),
  abortOngoingRequestsMock: vi.fn(),
  lmStudioGenerateMock: vi.fn(),
  lmStudioGenerateStreamMock: vi.fn(),
  lmStudioListModelsMock: vi.fn(),
  lmStudioResolveModelMock: vi.fn(),
  lmStudioListRunningModelsMock: vi.fn(),
  getLMStudioVersionMock: vi.fn(),
  lmStudioUnloadModelMock: vi.fn(),
  lmStudioSetDefaultKeepAliveMock: vi.fn(),
  lmStudioAbortOngoingRequestsMock: vi.fn(),
}));

vi.mock("../src/core/ollama-client.js", () => ({
  generate: generateMock,
  generateStream: generateStreamMock,
  listModels: listModelsMock,
  listRunningModels: listRunningModelsMock,
  getOllamaVersion: getOllamaVersionMock,
  unloadModel: unloadModelMock,
  setDefaultKeepAlive: setDefaultKeepAliveMock,
  abortOngoingRequests: abortOngoingRequestsMock,
}));

vi.mock("../src/core/lm-studio-client.js", () => ({
  generate: lmStudioGenerateMock,
  generateStream: lmStudioGenerateStreamMock,
  listModels: lmStudioListModelsMock,
  resolveModel: lmStudioResolveModelMock,
  listRunningModels: lmStudioListRunningModelsMock,
  getLMStudioVersion: getLMStudioVersionMock,
  unloadModel: lmStudioUnloadModelMock,
  setDefaultKeepAlive: lmStudioSetDefaultKeepAliveMock,
  abortOngoingRequests: lmStudioAbortOngoingRequestsMock,
}));

describe("runtime proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses default Ollama runtime through proxy exports", async () => {
    generateMock.mockResolvedValueOnce({ response: "ok" });
    generateStreamMock.mockResolvedValueOnce({ response: "ok" });
    listModelsMock.mockResolvedValue([{ name: "qwen2.5:7b" }]);
    listRunningModelsMock.mockResolvedValueOnce([{ name: "qwen2.5:7b" }]);
    getOllamaVersionMock.mockResolvedValueOnce("0.5.12");

    const runtime = await import("../src/core/runtime.js");
    expect(runtime.getRuntime().name).toBe("ollama");
    expect(runtime.getRuntimeName()).toBe("ollama");
    expect(runtime.getRuntimeModelFormat()).toBe("gguf");

    await runtime.generate("m", "p");
    await runtime.generateStream("m", "p");
    await runtime.listModels();
    await runtime.resolveRuntimeModel("m");
    await runtime.listRunningModels();
    await runtime.getRuntimeVersion();
    await runtime.unloadModel("m");
    runtime.setRuntimeKeepAlive("2m");
    runtime.abortOngoingRequests();

    expect(generateMock).toHaveBeenCalled();
    expect(generateStreamMock).toHaveBeenCalled();
    expect(listModelsMock).toHaveBeenCalledTimes(2);
    expect(listRunningModelsMock).toHaveBeenCalled();
    expect(getOllamaVersionMock).toHaveBeenCalled();
    expect(unloadModelMock).toHaveBeenCalledWith("m");
    expect(setDefaultKeepAliveMock).toHaveBeenCalledWith("2m");
    expect(abortOngoingRequestsMock).toHaveBeenCalled();
  });

  it("supports runtime override via setRuntime", async () => {
    const runtime = await import("../src/core/runtime.js");

    const custom = {
      name: "custom",
      modelFormat: "mlx",
      generate: vi.fn(async () => ({ response: "c1" })),
      generateStream: vi.fn(async () => ({ response: "c2" })),
      listModels: vi.fn(async () => [{ name: "x" }]),
      listRunningModels: vi.fn(async () => [{ name: "x" }]),
      getVersion: vi.fn(async () => "1.0.0"),
      unloadModel: vi.fn(async () => {}),
      setKeepAlive: vi.fn(),
      abort: vi.fn(),
    };

    runtime.setRuntime(custom);
    expect(runtime.getRuntime().name).toBe("custom");
    expect(runtime.getRuntimeName()).toBe("custom");
    expect(runtime.getRuntimeModelFormat()).toBe("mlx");

    await runtime.generate("m", "p");
    await runtime.generateStream("m", "p");
    await runtime.listModels();
    await runtime.resolveRuntimeModel("m");
    await runtime.listRunningModels();
    await runtime.getRuntimeVersion();
    await runtime.unloadModel("m");
    runtime.setRuntimeKeepAlive("1m");
    runtime.abortOngoingRequests();

    expect(custom.generate).toHaveBeenCalled();
    expect(custom.generateStream).toHaveBeenCalled();
    expect(custom.listModels).toHaveBeenCalledTimes(2);
    expect(custom.listRunningModels).toHaveBeenCalled();
    expect(custom.getVersion).toHaveBeenCalled();
    expect(custom.unloadModel).toHaveBeenCalledWith("m");
    expect(custom.setKeepAlive).toHaveBeenCalledWith("1m");
    expect(custom.abort).toHaveBeenCalled();
  });

  it("switches runtime via setRuntimeByName", async () => {
    lmStudioGenerateMock.mockResolvedValueOnce({ response: "lm-ok" });
    lmStudioGenerateStreamMock.mockResolvedValueOnce({ response: "lm-stream-ok" });
    lmStudioListModelsMock.mockResolvedValueOnce([{ name: "qwen3" }]);
    lmStudioResolveModelMock.mockResolvedValueOnce({ name: "qwen3", size: 0, modelFormat: "gglm" });
    lmStudioListRunningModelsMock.mockResolvedValueOnce([{ name: "qwen3" }]);
    getLMStudioVersionMock.mockResolvedValueOnce("unknown");

    const runtime = await import("../src/core/runtime.js");
    runtime.setRuntimeByName("lm-studio");

    expect(runtime.getRuntimeName()).toBe("lm-studio");
    expect(runtime.getRuntimeModelFormat()).toBe("gguf");

    await runtime.generate("m", "p");
    await runtime.generateStream("m", "p");
    await runtime.listModels();
    await runtime.resolveRuntimeModel("qwen3");
    await runtime.listRunningModels();
    await runtime.getRuntimeVersion();
    await runtime.unloadModel("m");
    runtime.setRuntimeKeepAlive("2m");
    runtime.abortOngoingRequests();

    expect(lmStudioGenerateMock).toHaveBeenCalled();
    expect(lmStudioGenerateStreamMock).toHaveBeenCalled();
    expect(lmStudioListModelsMock).toHaveBeenCalled();
    expect(lmStudioResolveModelMock).toHaveBeenCalledWith("qwen3");
    expect(lmStudioListRunningModelsMock).toHaveBeenCalled();
    expect(getLMStudioVersionMock).toHaveBeenCalled();
    expect(lmStudioUnloadModelMock).toHaveBeenCalledWith("m");
    expect(lmStudioSetDefaultKeepAliveMock).toHaveBeenCalledWith("2m");
    expect(lmStudioAbortOngoingRequestsMock).toHaveBeenCalled();
  });
});
