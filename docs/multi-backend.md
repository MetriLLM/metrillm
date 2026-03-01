# Multi-Backend Architecture

LLMeter supports multiple LLM inference backends through the `LLMRuntime` interface. Two dimensions affect benchmark scores:

- **Runtime backend** — the inference engine (Ollama, LM Studio, mlx-lm, llama.cpp, vLLM)
- **Model format** — the weight format (GGUF, MLX, Safetensors, ONNX)

These are independent: a single backend (e.g. LM Studio) can serve both GGUF and MLX models.

## Supported Backends

| Backend    | Format(s)          | API             | Default Port | Detection       |
|------------|--------------------|-----------------|--------------|-----------------|
| Ollama     | GGUF               | REST `/api`     | 11434        | `ollama serve`  |
| LM Studio  | GGUF, MLX          | OpenAI-compat   | 1234         | `/v1/models`    |
| mlx-lm     | MLX                | OpenAI-compat   | 8080         | `/v1/models`    |
| llama.cpp  | GGUF               | REST `/v1`      | 8080         | `/health`       |
| vLLM       | Safetensors, GGUF  | OpenAI-compat   | 8000         | `/v1/models`    |

## Model Formats

| Format      | Extension      | Quantization    | Typical Use                  |
|-------------|----------------|-----------------|------------------------------|
| GGUF        | `.gguf`        | Q4_K_M, Q5_K_M | CPU + GPU offload (llama.cpp)|
| MLX         | `.safetensors` | 4-bit, 8-bit   | Apple Silicon native (MLX)   |
| Safetensors | `.safetensors` | FP16, BF16      | GPU inference (vLLM, TGI)    |
| ONNX        | `.onnx`        | INT8, FP16      | Cross-platform optimized     |

## Architecture

### LLMRuntime Interface

```typescript
export interface LLMRuntime {
  name: string;              // "ollama" | "lm-studio" | "mlx" | "llamacpp" | "vllm"
  modelFormat?: string;      // "gguf" | "mlx" | "safetensors" | "onnx" (default: "gguf")
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
getRuntimeModelFormat(); // "gguf"
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

5. **Populate metadata** — `getRuntimeName()` and `getRuntimeModelFormat()` are auto-populated via the runtime proxy

6. **Add tests** — Unit tests for the new runtime, integration test with mocked API

7. **Update types** — Add backend name to `RunMetadata.runtimeBackend` JSDoc union

8. **Update companion site** — Mirror type changes in `metrillm-web`
