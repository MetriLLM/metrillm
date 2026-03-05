# Multi-Backend Architecture

MetriLLM supports multiple LLM inference backends through the `LLMRuntime` interface. Two dimensions affect benchmark scores:

- **Runtime backend** — the inference engine (Ollama, LM Studio, mlx-lm, llama.cpp, vLLM)
- **Model format** — the weight format reported by the runtime (for example: GGUF, MLX, Safetensors, ONNX, GGML)

These are independent: a single backend (e.g. LM Studio) can serve both GGUF and MLX models.

## Supported Backends

| Backend    | Format(s)          | API             | Default Port | Detection       |
|------------|--------------------|-----------------|--------------|-----------------|
| Ollama     | GGUF               | REST `/api`     | 11434        | `ollama serve`  |
| LM Studio  | Runtime-dependent  | Native REST     | 1234         | `/api/v1/models`|
| mlx-lm     | MLX                | OpenAI-compat   | 8080         | `/v1/models`    |
| llama.cpp  | GGUF               | REST `/v1`      | 8080         | `/health`       |
| vLLM       | Safetensors, GGUF  | OpenAI-compat   | 8000         | `/v1/models`    |

LM Studio notes:
- MetriLLM now uses LM Studio's native REST API, including `/api/v1/chat` for inference and `/api/v1/models` for primary model discovery.
- The previous OpenAI-compatible inference endpoint `/v1/chat/completions` has been removed from the LM Studio runtime adapter.
- Model discovery still uses LM Studio model listing endpoints because they expose inventory/runtime metadata needed by the CLI.

Shared stream stall timeout:
- MetriLLM uses one cross-backend stream watchdog flag: `--stream-stall-timeout-ms`.
- The matching environment variable is `METRILLM_STREAM_STALL_TIMEOUT_MS`.
- Default is `30000` ms for both Ollama and LM Studio; `0` disables the watchdog.

## Model Formats

Common examples MetriLLM may encounter:

| Format      | Extension      | Quantization    | Typical Use                  |
|-------------|----------------|-----------------|------------------------------|
| GGUF        | `.gguf`        | Q4_K_M, Q5_K_M | CPU + GPU offload (llama.cpp)|
| MLX         | `.safetensors` | 4-bit, 8-bit   | Apple Silicon native (MLX)   |
| Safetensors | `.safetensors` | FP16, BF16      | GPU inference (vLLM, TGI)    |
| ONNX        | `.onnx`        | INT8, FP16      | Cross-platform optimized     |
| GGML        | varies         | legacy / mixed  | Older llama-family runtimes  |

MetriLLM stores the exact runtime-reported format when available. If the backend cannot provide a trustworthy format, the result is stored as `unknown` rather than guessed.

## Architecture

### LLMRuntime Interface

```typescript
export interface LLMRuntime {
  name: string;              // "ollama" | "lm-studio" | "mlx" | "llamacpp" | "vllm"
  modelFormat?: string;      // runtime default format hint (not the exact per-model saved format)
  generate(...): Promise<GenerateResult>;
  generateStream(...): Promise<GenerateResult>;
  listModels(): Promise<OllamaModel[]>;
  listRunningModels(): Promise<OllamaRunningModel[]>;
  getVersion(): Promise<string>;
  unloadModel(model: string): Promise<void>;
  setKeepAlive(keepAlive?: KeepAliveValue): void;
  abort(): void;
}
```

### Runtime Selection

```typescript
import { setRuntime, getRuntime, getRuntimeName, getRuntimeModelFormat } from "./core/runtime.js";

// Default: OllamaRuntime
// Switch backend:
setRuntime(new LMStudioRuntime());

// Access backend info:
getRuntimeName();        // "lm-studio"
getRuntimeModelFormat(); // runtime default hint, e.g. "gguf"
```

## Database Schema

Two columns in the `benchmarks` table store backend information:

```sql
runtime_backend text not null default 'ollama'   -- indexed
model_format    text not null default 'gguf'      -- indexed
```

These are populated from `RunMetadata.runtimeBackend` and `RunMetadata.modelFormat` during upload.

## Adding a New Backend — Checklist

1. **Create runtime class** — `src/core/<backend>-runtime.ts` implementing `LLMRuntime`
   - Set `name` to the backend identifier (e.g. `"lm-studio"`)
   - Set `modelFormat` to the default format (e.g. `"gguf"`)
   - Implement all interface methods (generate, listModels, etc.)

2. **Create client module** — `src/core/<backend>-client.ts` for low-level API calls

3. **Register in factory** — Add backend to a factory/switch in CLI option handling

4. **Add CLI option** — `--backend <name>` option in `src/commands/bench.ts`

5. **Populate metadata** — `getRuntimeName()` is auto-populated via the runtime proxy; exact `modelFormat` should come from per-model runtime metadata when available

6. **Add tests** — Unit tests for the new runtime, integration test with mocked API

7. **Update types** — Add backend name to `RunMetadata.runtimeBackend` JSDoc union

8. **Update companion site** — Mirror type changes in `metrillm-web`
