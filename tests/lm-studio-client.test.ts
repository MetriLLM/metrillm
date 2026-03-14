import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function nativeChatResponse(
  response: string,
  options?: {
    reasoning?: string;
    inputTokens?: number;
    outputTokens?: number;
    tokensPerSecond?: number;
    ttftSeconds?: number;
    loadSeconds?: number;
  }
): Response {
  return jsonResponse({
    output: [
      ...(options?.reasoning ? [{ type: "reasoning", content: options.reasoning }] : []),
      { type: "message", content: response },
    ],
    stats: {
      input_tokens: options?.inputTokens ?? 3,
      total_output_tokens: options?.outputTokens ?? 1,
      tokens_per_second: options?.tokensPerSecond ?? 5,
      time_to_first_token_seconds: options?.ttftSeconds ?? 0.1,
      model_load_time_seconds: options?.loadSeconds ?? 0,
    },
  });
}

function nativeStreamResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  const sse = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }
  );
}

function requestPath(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.pathname;
  if (typeof input === "string") return new URL(input).pathname;
  if (input instanceof Request) return new URL(input.url).pathname;
  return "";
}

describe("lm-studio-client metadata mapping", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    delete process.env.LM_STUDIO_BASE_URL;
    delete process.env.LM_STUDIO_API_KEY;
    delete process.env.METRILLM_STREAM_STALL_TIMEOUT_MS;
    const isolatedRoot = path.join(os.tmpdir(), `lmstudio-empty-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    process.env.LM_STUDIO_HOME_DIR = isolatedRoot;
    process.env.LM_STUDIO_MODELS_DIR = path.join(isolatedRoot, "models");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (tempDir) {
      return rm(tempDir, { recursive: true, force: true }).then(() => {
        tempDir = null;
      });
    }
  });

  it("enriches model metadata from /api/v0/models", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/v1/models") {
        return jsonResponse({
          object: "list",
          data: [{ id: "openai/gpt-oss-20b" }, { id: "qwen/qwen3-coder-30b" }],
        });
      }
      if (path === "/api/v0/models") {
        return jsonResponse({
          object: "list",
          data: [
            { id: "openai/gpt-oss-20b", quantization: "MXFP4", arch: "gpt_oss" },
            { id: "qwen/qwen3-coder-30b", quantization: "4bit", arch: "qwen3_moe" },
          ],
        });
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const models = await client.listModels();

    expect(models).toEqual([
      {
        name: "openai/gpt-oss-20b",
        size: 0,
        parameterSize: "20B",
        quantization: "MXFP4",
        runtimeStatus: undefined,
        modelFormat: undefined,
        family: "gpt_oss",
      },
      {
        name: "qwen/qwen3-coder-30b",
        size: 0,
        parameterSize: "30B",
        quantization: "4bit",
        runtimeStatus: undefined,
        modelFormat: undefined,
        family: "qwen3_moe",
      },
    ]);
  });

  it("falls back gracefully when /api/v0/models is unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/v1/models") {
        return jsonResponse({
          object: "list",
          data: [{ id: "qwen2.5:7b" }],
        });
      }
      if (path === "/api/v0/models") {
        return jsonResponse({ error: "not found" }, 404);
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const models = await client.listModels();

    expect(models).toEqual([
      {
        name: "qwen2.5:7b",
        size: 0,
        parameterSize: "7B",
        quantization: undefined,
        runtimeStatus: undefined,
        modelFormat: undefined,
        family: undefined,
      },
    ]);
  });

  it("includes downloaded models from /api/v0/models when /api/v1/models is empty", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqPath = requestPath(input);
      if (reqPath === "/api/v1/models") {
        return jsonResponse({
          object: "list",
          data: [],
        });
      }
      if (reqPath === "/api/v0/models") {
        return jsonResponse({
          object: "list",
          data: [
            { id: "openai/gpt-oss-20b", quantization: "MXFP4", arch: "gpt_oss", state: "not-loaded" },
            { id: "qwen/qwen3-coder-30b", quantization: "4bit", arch: "qwen3_moe", state: "not-loaded" },
          ],
        });
      }
      throw new Error(`Unexpected path: ${reqPath}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const models = await client.listModels();

    expect(models).toEqual([
      {
        name: "openai/gpt-oss-20b",
        size: 0,
        parameterSize: "20B",
        quantization: "MXFP4",
        runtimeStatus: "not-loaded",
        modelFormat: undefined,
        family: "gpt_oss",
      },
      {
        name: "qwen/qwen3-coder-30b",
        size: 0,
        parameterSize: "30B",
        quantization: "4bit",
        runtimeStatus: "not-loaded",
        modelFormat: undefined,
        family: "qwen3_moe",
      },
    ]);
  });

  it("detects loaded models from /api/v0/models state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/v0/models") {
        return jsonResponse({
          object: "list",
          data: [
            { id: "openai/gpt-oss-20b", state: "loaded", size_bytes: 12_345 },
            { id: "google/gemma-3-12b", state: "not-loaded", size_bytes: 54_321 },
          ],
        });
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const running = await client.listRunningModels();

    expect(running).toEqual([
      {
        name: "openai/gpt-oss-20b",
        size: 12_345,
        vramUsed: 0,
      },
    ]);
  });

  it("resolves local size and params from LM Studio hub metadata", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "lmstudio-client-"));
    const modelsDir = path.join(tempDir, "models");
    process.env.LM_STUDIO_HOME_DIR = tempDir;
    process.env.LM_STUDIO_MODELS_DIR = modelsDir;

    const yamlPath = path.join(
      tempDir,
      "hub",
      "models",
      "mistralai",
      "magistral-small-2509",
      "model.yaml"
    );
    await mkdir(path.dirname(yamlPath), { recursive: true });
    await writeFile(
      yamlPath,
      [
        "model: mistralai/magistral-small-2509",
        "base:",
        "  - key: lmstudio-community/magistral-small-2509-mlx-4bit",
        "    sources:",
        "      - type: huggingface",
        "        user: lmstudio-community",
        "        repo: Magistral-Small-2509-MLX-4bit",
        "metadataOverrides:",
        "  paramsStrings:",
        "    - 24B",
      ].join("\n"),
      "utf8"
    );

    const modelDir = path.join(modelsDir, "lmstudio-community", "Magistral-Small-2509-MLX-4bit");
    await mkdir(modelDir, { recursive: true });
    await writeFile(path.join(modelDir, "model-00001-of-00002.safetensors"), Buffer.alloc(1024));
    await writeFile(path.join(modelDir, "model-00002-of-00002.safetensors"), Buffer.alloc(2048));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqPath = requestPath(input);
      if (reqPath === "/api/v1/models") {
        return jsonResponse({
          object: "list",
          data: [{ id: "mistralai/magistral-small-2509" }],
        });
      }
      if (reqPath === "/api/v0/models") {
        return jsonResponse({
          object: "list",
          data: [
            {
              id: "mistralai/magistral-small-2509",
              quantization: "4bit",
              compatibility_type: "mlx",
              arch: "mistral3",
              state: "not-loaded",
            },
          ],
        });
      }
      throw new Error(`Unexpected path: ${reqPath}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const models = await client.listModels();

    expect(models).toEqual([
      {
        name: "mistralai/magistral-small-2509",
        size: 3072,
        parameterSize: "24B",
        quantization: "4bit",
        runtimeStatus: "not-loaded",
        modelFormat: "mlx",
        family: "mistral3",
      },
    ]);
  });

  it("resolves exact model formats beyond gguf/mlx for a benchmarked LM Studio model", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqPath = requestPath(input);
      if (reqPath === "/api/v0/models") {
        return jsonResponse({
          object: "list",
          data: [
            {
              id: "some-publisher/custom-model",
              compatibility_type: "gglm",
              quantization: "4bit",
              arch: "custom",
            },
          ],
        });
      }
      throw new Error(`Unexpected path: ${reqPath}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const model = await client.resolveModel("some-publisher/custom-model");

    expect(model).toMatchObject({
      name: "some-publisher/custom-model",
      modelFormat: "gglm",
      quantization: "4bit",
      family: "custom",
    });
  });

  it("does not invent a model format when LM Studio omits compatibility_type", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqPath = requestPath(input);
      if (reqPath === "/api/v0/models") {
        return jsonResponse({
          object: "list",
          data: [
            {
              id: "some-publisher/custom-model-gguf",
              quantization: "4bit",
              arch: "custom",
            },
          ],
        });
      }
      throw new Error(`Unexpected path: ${reqPath}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const model = await client.resolveModel("some-publisher/custom-model-gguf");

    expect(model).toMatchObject({
      name: "some-publisher/custom-model-gguf",
      modelFormat: undefined,
      quantization: "4bit",
      family: "custom",
    });
  });

  it("returns null without triggering an interactive estimate when no exact loaded model matches", async () => {
    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify([]), "");
      return {} as ReturnType<typeof execFileMock>;
    });

    const client = await import("../src/core/lm-studio-client.js");
    const estimated = await client.estimateLoadedModelMemoryBytes("qwen2.5:7b");

    expect(estimated).toBeNull();
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      expect.any(String),
      ["ps", "--json"],
      expect.objectContaining({ timeout: 8_000 }),
      expect.any(Function)
    );
  });

  it("estimates memory from the exact loaded-model path reported by LM Studio CLI", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => {
        cb(null, JSON.stringify([
          {
            path: "lmstudio-community/Phi-4-reasoning-plus-MLX-4bit",
            modelKey: "microsoft/phi-4-reasoning-plus",
            contextLength: 32768,
          },
        ]), "");
        return {} as ReturnType<typeof execFileMock>;
      })
      .mockImplementationOnce((_cmd, _args, _opts, cb) => {
        cb(
          null,
          [
            "Model: microsoft/phi-4-reasoning-plus",
            "Estimated Total Memory: 10.77 GiB",
          ].join("\n"),
          ""
        );
        return {} as ReturnType<typeof execFileMock>;
      });

    const client = await import("../src/core/lm-studio-client.js");
    const estimated = await client.estimateLoadedModelMemoryBytes("lmstudio-community/Phi-4-reasoning-plus-MLX-4bit");

    expect(estimated).toBeGreaterThan(10 * 1024 ** 3);
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      [
        "load",
        "--estimate-only",
        "-y",
        "--context-length",
        "32768",
        "lmstudio-community/Phi-4-reasoning-plus-MLX-4bit",
      ],
      expect.objectContaining({ timeout: 8_000 }),
      expect.any(Function)
    );
  });

  it("falls back to bundled publisher directory size when hub metadata is missing", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "lmstudio-bundled-"));
    const modelsDir = path.join(tempDir, "models");
    process.env.LM_STUDIO_HOME_DIR = tempDir;
    process.env.LM_STUDIO_MODELS_DIR = modelsDir;

    const bundledDir = path.join(
      tempDir,
      ".internal",
      "bundled-models",
      "nomic-ai",
      "nomic-embed-text-v1.5-GGUF"
    );
    await mkdir(bundledDir, { recursive: true });
    await writeFile(path.join(bundledDir, "model.gguf"), Buffer.alloc(4096));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqPath = requestPath(input);
      if (reqPath === "/api/v1/models") {
        return jsonResponse({
          object: "list",
          data: [{ id: "text-embedding-nomic-embed-text-v1.5" }],
        });
      }
      if (reqPath === "/api/v0/models") {
        return jsonResponse({
          object: "list",
          data: [
            {
              id: "text-embedding-nomic-embed-text-v1.5",
              publisher: "nomic-ai",
              compatibility_type: "gguf",
              quantization: "Q4_K_M",
              arch: "nomic-bert",
              state: "not-loaded",
            },
          ],
        });
      }
      throw new Error(`Unexpected path: ${reqPath}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const models = await client.listModels();

    expect(models).toEqual([
      {
        name: "text-embedding-nomic-embed-text-v1.5",
        size: 4096,
        parameterSize: undefined,
        quantization: "Q4_K_M",
        runtimeStatus: "not-loaded",
        modelFormat: "gguf",
        family: "nomic-bert",
      },
    ]);
  });

  it("falls back to historical local app version when API header is missing", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "lmstudio-version-"));
    process.env.LM_STUDIO_HOME_DIR = tempDir;
    process.env.LM_STUDIO_MODELS_DIR = path.join(tempDir, "models");

    const historicalPath = path.join(tempDir, ".internal", "historical-version-info.json");
    await mkdir(path.dirname(historicalPath), { recursive: true });
    await writeFile(
      historicalPath,
      JSON.stringify({
        lastRecorderdAppVersion: "0.4.6",
        lastRecordedAppBuildVersion: "1",
      }),
      "utf8"
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const reqPath = requestPath(input);
      if (reqPath === "/api/v1/models") {
        return jsonResponse({ object: "list", data: [] });
      }
      throw new Error(`Unexpected path: ${reqPath}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const version = await client.getLMStudioVersion();

    expect(version).toBe("0.4.6+1");
  });
});

describe("lm-studio-client thinking toggle passthrough", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.LM_STUDIO_BASE_URL;
    delete process.env.LM_STUDIO_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends thinking config when generate() receives think=true/false", async () => {
    const capturedBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      capturedBodies.push(JSON.parse(rawBody));
      expect(requestPath(input)).toBe("/api/v1/chat");
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");

    await client.generate("model-a", "prompt", { think: true });
    await client.generate("model-a", "prompt", { think: false });
    await client.generate("model-a", "prompt");

    expect(capturedBodies).toHaveLength(3);
    expect(capturedBodies[0]).toMatchObject({
      model: "model-a",
      input: "prompt",
      reasoning: "high",
      max_output_tokens: 512,
    });
    expect(capturedBodies[1]).toMatchObject({
      model: "model-a",
      input: "prompt",
      system_prompt: expect.any(String),
      max_output_tokens: 512,
    });
    expect((capturedBodies[1] as { system_prompt?: string }).system_prompt).toMatch(
      /non-thinking mode/i
    );
    expect(capturedBodies[2]).not.toHaveProperty("reasoning");
    expect(capturedBodies[2]).not.toHaveProperty("system_prompt");
    expect(capturedBodies[2]).toMatchObject({
      model: "model-a",
      input: "prompt",
      max_output_tokens: 512,
    });
  });

  it("forwards top_p and seed when provided", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      capturedBody = JSON.parse(rawBody) as Record<string, unknown>;
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    await client.generate("model-a", "prompt", { top_p: 1, seed: 42 });

    expect(capturedBody).toMatchObject({
      top_p: 1,
      seed: 42,
    });
  });

  it("uses max_output_tokens for native chat requests", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      capturedBody = JSON.parse(rawBody) as Record<string, unknown>;
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    await client.generate("model-a", "prompt", { num_predict: 256 });

    expect(capturedBody).toMatchObject({
      model: "model-a",
      input: "prompt",
      max_output_tokens: 256,
    });
    expect(capturedBody).not.toHaveProperty("max_tokens");
  });

  it("retries with legacy max_tokens when backend rejects max_output_tokens", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: "Unrecognized key(s) in object: 'max_output_tokens'" }, 400);
      }
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generate("model-a", "prompt", { num_predict: 256 });

    expect(result.response).toBe("OK");
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ max_output_tokens: 256 });
    expect(capturedBodies[0]).not.toHaveProperty("max_tokens");
    expect(capturedBodies[1]).toMatchObject({ max_tokens: 256 });
    expect(capturedBodies[1]).not.toHaveProperty("max_output_tokens");
  });

  it("retries with legacy max_tokens when backend reports invalid field max_output_tokens", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: { message: "invalid field 'max_output_tokens'" } }, 400);
      }
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generate("model-a", "prompt", { num_predict: 256 });

    expect(result.response).toBe("OK");
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ max_output_tokens: 256 });
    expect(capturedBodies[1]).toMatchObject({ max_tokens: 256 });
  });

  it("retries with legacy max_tokens when backend says max_tokens is required", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: { message: "max_tokens is required" } }, 400);
      }
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generate("model-a", "prompt", { num_predict: 256 });

    expect(result.response).toBe("OK");
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ max_output_tokens: 256 });
    expect(capturedBodies[1]).toMatchObject({ max_tokens: 256 });
  });

  it("reuses the negotiated legacy output-limit mode on later requests", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: "Unrecognized key(s) in object: 'max_output_tokens'" }, 400);
      }
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    await client.generate("model-a", "prompt-1", { num_predict: 256 });
    await client.generate("model-a", "prompt-2", { num_predict: 128 });

    expect(capturedBodies).toHaveLength(3);
    expect(capturedBodies[0]).toMatchObject({ input: "prompt-1", max_output_tokens: 256 });
    expect(capturedBodies[1]).toMatchObject({ input: "prompt-1", max_tokens: 256 });
    expect(capturedBodies[2]).toMatchObject({ input: "prompt-2", max_tokens: 128 });
    expect(capturedBodies[2]).not.toHaveProperty("max_output_tokens");
  });

  it("retries without top_p/seed when backend rejects sampling options (non-stream)", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: "Unrecognized key(s) in object: 'seed'" }, 400);
      }
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generate("model-a", "prompt", { top_p: 1, seed: 42 });

    expect(result.response).toBe("OK");
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ top_p: 1, seed: 42 });
    expect(capturedBodies[1]).not.toHaveProperty("top_p");
    expect(capturedBodies[1]).not.toHaveProperty("seed");
  });

  it("still retries sampling fallback when backend reports invalid top_p/seed fields", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: { message: "invalid field 'top_p'" } }, 400);
      }
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generate("model-a", "prompt", { top_p: 1, seed: 42 });

    expect(result.response).toBe("OK");
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ top_p: 1, seed: 42 });
    expect(capturedBodies[1]).not.toHaveProperty("top_p");
    expect(capturedBodies[1]).not.toHaveProperty("seed");
  });

  it("fails explicitly when backend rejects both max_output_tokens and max_tokens", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: "Unrecognized key(s) in object: 'max_output_tokens'" }, 400);
      }
      if (capturedBodies.length === 2) {
        return jsonResponse({ error: "Unrecognized key(s) in object: 'max_tokens'" }, 400);
      }
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    await expect(client.generate("model-a", "prompt", { num_predict: 64 })).rejects.toThrow(
      /rejected both max_output_tokens and max_tokens/i
    );

    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ max_output_tokens: 64 });
    expect(capturedBodies[0]).not.toHaveProperty("max_tokens");
    expect(capturedBodies[1]).toMatchObject({ max_tokens: 64 });
    expect(capturedBodies[1]).not.toHaveProperty("max_output_tokens");
  });

  it("does not treat an invalid max_output_tokens value as an unsupported field", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      return jsonResponse(
        { error: { message: "Invalid max_output_tokens value: must be <= 512" } },
        400
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    await expect(client.generate("model-a", "prompt", { num_predict: 1024 })).rejects.toThrow(
      /invalid max_output_tokens value/i
    );

    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0]).toMatchObject({ max_output_tokens: 1024 });
    expect(capturedBodies[0]).not.toHaveProperty("max_tokens");
  });

  it("retries stream request without top_p/seed when backend rejects sampling options", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      expect(requestPath(input)).toBe("/api/v1/chat");
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: "Unexpected key 'top_p'" }, 400);
      }
      return nativeStreamResponse([
        { type: "message.delta", delta: "OK" },
        {
          type: "chat.end",
          result: {
            output: [{ type: "message", content: "OK" }],
            stats: {
              input_tokens: 3,
              total_output_tokens: 1,
              tokens_per_second: 10,
              time_to_first_token_seconds: 0.1,
            },
          },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generateStream("model-a", "prompt", undefined, { top_p: 1, seed: 42 });

    expect(result.response).toBe("OK");
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ top_p: 1, seed: 42, stream: true });
    expect(capturedBodies[1]).toMatchObject({ stream: true });
    expect(capturedBodies[1]).not.toHaveProperty("top_p");
    expect(capturedBodies[1]).not.toHaveProperty("seed");
  });

  it("fails explicitly in stream mode when backend rejects both max_output_tokens and max_tokens", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: "Unrecognized key(s) in object: 'max_output_tokens'" }, 400);
      }
      if (capturedBodies.length === 2) {
        return jsonResponse({ error: "Unrecognized key(s) in object: 'max_tokens'" }, 400);
      }
      return nativeStreamResponse([
        { type: "message.delta", delta: "OK" },
        {
          type: "chat.end",
          result: {
            output: [{ type: "message", content: "OK" }],
            stats: {
              input_tokens: 3,
              total_output_tokens: 1,
              tokens_per_second: 10,
              time_to_first_token_seconds: 0.1,
            },
          },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    await expect(client.generateStream("model-a", "prompt", undefined, { num_predict: 64 })).rejects.toThrow(
      /rejected both max_output_tokens and max_tokens/i
    );

    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ max_output_tokens: 64, stream: true });
    expect(capturedBodies[0]).not.toHaveProperty("max_tokens");
    expect(capturedBodies[1]).toMatchObject({ max_tokens: 64, stream: true });
    expect(capturedBodies[1]).not.toHaveProperty("max_output_tokens");
  });

  it("does not retry stream requests when max_output_tokens fails validation", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      return jsonResponse(
        { error: { message: "Invalid max_output_tokens value: must be <= 512" } },
        400
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    await expect(client.generateStream("model-a", "prompt", undefined, { num_predict: 1024 })).rejects.toThrow(
      /invalid max_output_tokens value/i
    );

    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0]).toMatchObject({ max_output_tokens: 1024, stream: true });
    expect(capturedBodies[0]).not.toHaveProperty("max_tokens");
  });

  it("retries stream request with legacy max_tokens when backend rejects max_output_tokens", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      expect(requestPath(input)).toBe("/api/v1/chat");
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: "Unexpected key 'max_output_tokens'" }, 400);
      }
      return nativeStreamResponse([
        { type: "message.delta", delta: "OK" },
        {
          type: "chat.end",
          result: {
            output: [{ type: "message", content: "OK" }],
            stats: {
              input_tokens: 3,
              total_output_tokens: 1,
              tokens_per_second: 10,
              time_to_first_token_seconds: 0.1,
            },
          },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generateStream("model-a", "prompt", undefined, { num_predict: 256 });

    expect(result.response).toBe("OK");
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ max_output_tokens: 256, stream: true });
    expect(capturedBodies[0]).not.toHaveProperty("max_tokens");
    expect(capturedBodies[1]).toMatchObject({ max_tokens: 256, stream: true });
    expect(capturedBodies[1]).not.toHaveProperty("max_output_tokens");
  });

  it("retries stream request with legacy max_tokens when backend reports invalid field max_output_tokens", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: { message: "invalid field 'max_output_tokens'" } }, 400);
      }
      return nativeStreamResponse([
        { type: "message.delta", delta: "OK" },
        {
          type: "chat.end",
          result: {
            output: [{ type: "message", content: "OK" }],
            stats: {
              input_tokens: 3,
              total_output_tokens: 1,
              tokens_per_second: 10,
              time_to_first_token_seconds: 0.1,
            },
          },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generateStream("model-a", "prompt", undefined, { num_predict: 256 });

    expect(result.response).toBe("OK");
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ max_output_tokens: 256, stream: true });
    expect(capturedBodies[1]).toMatchObject({ max_tokens: 256, stream: true });
  });

  it("retries stream request with legacy max_tokens when backend says max_tokens is required", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: { message: "max_tokens is required" } }, 400);
      }
      return nativeStreamResponse([
        { type: "message.delta", delta: "OK" },
        {
          type: "chat.end",
          result: {
            output: [{ type: "message", content: "OK" }],
            stats: {
              input_tokens: 3,
              total_output_tokens: 1,
              tokens_per_second: 10,
              time_to_first_token_seconds: 0.1,
            },
          },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generateStream("model-a", "prompt", undefined, { num_predict: 256 });

    expect(result.response).toBe("OK");
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toMatchObject({ max_output_tokens: 256, stream: true });
    expect(capturedBodies[1]).toMatchObject({ max_tokens: 256, stream: true });
  });

  it("shares the cached legacy output-limit mode between generate and stream requests", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: "Unexpected key 'max_output_tokens'" }, 400);
      }
      if (parsed.stream === true) {
        return nativeStreamResponse([
          { type: "message.delta", delta: "OK" },
          {
            type: "chat.end",
            result: {
              output: [{ type: "message", content: "OK" }],
              stats: {
                input_tokens: 3,
                total_output_tokens: 1,
                tokens_per_second: 10,
                time_to_first_token_seconds: 0.1,
              },
            },
          },
        ]);
      }
      return nativeChatResponse("OK");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    await client.generate("model-a", "prompt-1", { num_predict: 256 });
    await client.generateStream("model-a", "prompt-2", undefined, { num_predict: 128 });

    expect(capturedBodies).toHaveLength(3);
    expect(capturedBodies[0]).toMatchObject({ input: "prompt-1", max_output_tokens: 256 });
    expect(capturedBodies[1]).toMatchObject({ input: "prompt-1", max_tokens: 256 });
    expect(capturedBodies[2]).toMatchObject({ input: "prompt-2", max_tokens: 128, stream: true });
    expect(capturedBodies[2]).not.toHaveProperty("max_output_tokens");
  });

  it("shows actionable guidance when LM Studio blocks model load in non-stream mode", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message:
              "Failed to load model \"zai-org/glm-4.7-flash\". Error: Model loading was stopped due to insufficient system resources. Continuing to load the model would likely overload your system and cause it to freeze. If you think this is incorrect, you can adjust the model loading guardrails in settings.",
          },
        },
        400
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");

    await expect(client.generate("zai-org/glm-4.7-flash", "prompt")).rejects.toThrow(
      /could not load model "zai-org\/glm-4\.7-flash" due to insufficient system resources/i
    );
    await expect(client.generate("zai-org/glm-4.7-flash", "prompt")).rejects.toThrow(
      /unload other models, reduce loaded context length, or relax model loading guardrails/i
    );
  });

  it("shows actionable guidance when LM Studio blocks model load in stream mode", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message:
              "Failed to load model \"zai-org/glm-4.7-flash\". Error: Model loading was stopped due to insufficient system resources. Continuing to load the model would likely overload your system and cause it to freeze. If you think this is incorrect, you can adjust the model loading guardrails in settings.",
          },
        },
        400
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");

    await expect(client.generateStream("zai-org/glm-4.7-flash", "prompt")).rejects.toThrow(
      /could not load model "zai-org\/glm-4\.7-flash" due to insufficient system resources/i
    );
    await expect(client.generateStream("zai-org/glm-4.7-flash", "prompt")).rejects.toThrow(
      /unload other models, reduce loaded context length, or relax model loading guardrails/i
    );
  });

  it("sends thinking config when generateStream() receives think=false", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      capturedBody = JSON.parse(rawBody) as Record<string, unknown>;
      expect(requestPath(input)).toBe("/api/v1/chat");

      return nativeStreamResponse([
        { type: "message.delta", delta: "OK" },
        {
          type: "chat.end",
          result: {
            output: [{ type: "message", content: "OK" }],
            stats: {
              input_tokens: 3,
              total_output_tokens: 1,
              tokens_per_second: 10,
              time_to_first_token_seconds: 0.1,
            },
          },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generateStream("model-a", "prompt", undefined, { think: false });

    expect(result.response).toBe("OK");
    expect(capturedBody).toMatchObject({
      stream: true,
      model: "model-a",
      input: "prompt",
      system_prompt: expect.any(String),
      max_output_tokens: 512,
    });
    expect(capturedBody?.system_prompt).toMatch(
      /do not output internal reasoning/i
    );
  });

  it("falls back to estimated completion token count when native stats are missing in stream", async () => {
    const fetchMock = vi.fn(async () => {
      return nativeStreamResponse([
        { type: "reasoning.delta", delta: "reasoning token" },
        { type: "message.delta", delta: "final answer" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generateStream("model-a", "prompt");

    expect(result.evalCount).toBeGreaterThanOrEqual(4);
    expect(result.evalCountEstimated).toBe(true);
  });

  it("uses the shared 30s stall timeout by default for streaming", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn(async () =>
      nativeStreamResponse([
        { type: "message.delta", delta: "OK" },
        {
          type: "chat.end",
          result: {
            output: [{ type: "message", content: "OK" }],
            stats: {
              input_tokens: 3,
              total_output_tokens: 1,
              tokens_per_second: 10,
              time_to_first_token_seconds: 0.1,
            },
          },
        },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const client = await import("../src/core/lm-studio-client.js");
      await client.generateStream("model-a", "prompt");

      expect(
        setTimeoutSpy.mock.calls.some((call) => call[1] === 30_000)
      ).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("reads the shared stream stall timeout environment override", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    process.env.METRILLM_STREAM_STALL_TIMEOUT_MS = "2345";
    const fetchMock = vi.fn(async () =>
      nativeStreamResponse([
        { type: "message.delta", delta: "OK" },
        {
          type: "chat.end",
          result: {
            output: [{ type: "message", content: "OK" }],
            stats: {
              input_tokens: 3,
              total_output_tokens: 1,
              tokens_per_second: 10,
              time_to_first_token_seconds: 0.1,
            },
          },
        },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const client = await import("../src/core/lm-studio-client.js");
      await client.generateStream("model-a", "prompt");

      expect(
        setTimeoutSpy.mock.calls.some((call) => call[1] === 2345)
      ).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("uses robust fallback token estimation for non-whitespace scripts when native stats are missing", async () => {
    const fetchMock = vi.fn(async () => {
      return nativeStreamResponse([
        { type: "message.delta", delta: "你好世界你好世界" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generateStream("model-a", "prompt");

    expect(result.evalCount).toBeGreaterThan(1);
  });

  it("measures evalDuration across generated tokens (reasoning and content)", async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      now += 100;
      return now;
    });

    const fetchMock = vi.fn(async () => {
      return nativeStreamResponse([
        { type: "reasoning.delta", delta: "plan" },
        { type: "message.delta", delta: "ok" },
        {
          type: "chat.end",
          result: {
            output: [
              { type: "reasoning", content: "plan" },
              { type: "message", content: "ok" },
            ],
            stats: {
              input_tokens: 3,
              total_output_tokens: 5,
              tokens_per_second: 50,
              time_to_first_token_seconds: 0.1,
            },
          },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const client = await import("../src/core/lm-studio-client.js");
      const result = await client.generateStream("model-a", "prompt");

      expect(result.evalDuration).toBe(100_000_000);
      expect(result.promptEvalDuration).toBe(100_000_000);
      expect(result.evalCount).toBe(5);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("fails fast when non-thinking mode still returns plain-text thinking traces", async () => {
    const fetchMock = vi.fn(async () =>
      nativeChatResponse("Thinking Process:\n1. analyze\n2. answer")
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");

    await expect(
      client.generate("model-a", "prompt", { think: false })
    ).rejects.toThrow(/still emitted thinking content/i);
    await expect(
      client.generate("model-a", "prompt", { think: false })
    ).rejects.toThrow(/\{%- set enable_thinking = false %\}/);
  });

  it("fails fast when non-thinking mode still returns [THINK]...[/THINK] traces", async () => {
    const fetchMock = vi.fn(async () =>
      nativeChatResponse("[THINK]I should reason first[/THINK]Final answer")
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");

    await expect(
      client.generate("model-a", "prompt", { think: false })
    ).rejects.toThrow(/still emitted thinking content/i);
  });

  it("does not fail on generic 'Reasoning Process' phrasing when no thinking field is present", async () => {
    const fetchMock = vi.fn(async () =>
      nativeChatResponse("Reasoning Process: pick option A because it is simpler.")
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generate("model-a", "prompt", { think: false });
    expect(result.response).toContain("Reasoning Process:");
  });
});
