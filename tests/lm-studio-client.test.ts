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
});
