import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
    delete process.env.LM_STUDIO_BASE_URL;
    delete process.env.LM_STUDIO_API_KEY;
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
      if (path === "/v1/models") {
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
      if (path === "/v1/models") {
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
      if (reqPath === "/v1/models") {
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
      if (reqPath === "/v1/models") {
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
      if (reqPath === "/v1/models") {
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      capturedBodies.push(JSON.parse(rawBody));
      return jsonResponse({
        choices: [{ message: { content: "OK" } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");

    await client.generate("model-a", "prompt", { think: true });
    await client.generate("model-a", "prompt", { think: false });
    await client.generate("model-a", "prompt");

    expect(capturedBodies).toHaveLength(3);
    expect(capturedBodies[0]).toMatchObject({
      include_reasoning: true,
      reasoning_effort: "high",
      reasoning: { effort: "high" },
    });
    expect(capturedBodies[1]).toMatchObject({
      include_reasoning: false,
      reasoning_effort: "low",
      reasoning: { effort: "low" },
    });
    expect(capturedBodies[2]).not.toHaveProperty("include_reasoning");
    expect(capturedBodies[2]).not.toHaveProperty("reasoning_effort");
    expect(capturedBodies[2]).not.toHaveProperty("reasoning");
  });

  it("forwards top_p and seed when provided", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      capturedBody = JSON.parse(rawBody) as Record<string, unknown>;
      return jsonResponse({
        choices: [{ message: { content: "OK" } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    await client.generate("model-a", "prompt", { top_p: 1, seed: 42 });

    expect(capturedBody).toMatchObject({
      top_p: 1,
      seed: 42,
    });
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
      return jsonResponse({
        choices: [{ message: { content: "OK" } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      });
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

  it("retries stream request without top_p/seed when backend rejects sampling options", async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      capturedBodies.push(parsed);
      if (capturedBodies.length === 1) {
        return jsonResponse({ error: "Unexpected key 'top_p'" }, 400);
      }
      const sse =
        "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\n" +
        "data: [DONE]\n\n";
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
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      capturedBody = JSON.parse(rawBody) as Record<string, unknown>;

      const sse =
        "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\n" +
        "data: [DONE]\n\n";

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
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generateStream("model-a", "prompt", undefined, { think: false });

    expect(result.response).toBe("OK");
    expect(capturedBody).toMatchObject({
      stream: true,
      include_reasoning: false,
      reasoning_effort: "low",
      reasoning: { effort: "low" },
    });
  });

  it("fails fast when non-thinking mode still returns plain-text thinking traces", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: "Thinking Process:\n1. analyze\n2. answer" } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");

    await expect(
      client.generate("model-a", "prompt", { think: false })
    ).rejects.toThrow(/still emitted thinking content/i);
    await expect(
      client.generate("model-a", "prompt", { think: false })
    ).rejects.toThrow(/\{%- set enable_thinking = false %\}/);
  });

  it("does not fail on generic 'Reasoning Process' phrasing when no thinking field is present", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: "Reasoning Process: pick option A because it is simpler." } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../src/core/lm-studio-client.js");
    const result = await client.generate("model-a", "prompt", { think: false });
    expect(result.response).toContain("Reasoning Process:");
  });
});
