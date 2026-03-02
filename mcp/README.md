# MetriLLM MCP Server

[![npm version](https://img.shields.io/npm/v/metrillm-mcp)](https://www.npmjs.com/package/metrillm-mcp)

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) server for [MetriLLM](https://github.com/MetriLLM/metrillm) — benchmark local LLMs directly from Claude Code, Cursor, Windsurf, Continue.dev, or any MCP-compatible client.

## Quick Start

### Claude Code

```bash
claude mcp add metrillm -- npx metrillm-mcp@latest
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "metrillm": {
      "command": "npx",
      "args": ["metrillm-mcp@latest"]
    }
  }
}
```

### Cursor / Windsurf / Continue.dev

Add to your editor's MCP configuration:

```json
{
  "mcpServers": {
    "metrillm": {
      "command": "npx",
      "args": ["metrillm-mcp@latest"]
    }
  }
}
```

## Prerequisites

- Node.js >= 20
- [Ollama](https://ollama.com) installed and running (`ollama serve`)
- At least one model available (`ollama pull llama3.2:3b`)

## Available Tools

### `list_models`

List all locally available LLM models.

| Param | Type | Default | Description |
|---|---|---|---|
| `runtime` | `"ollama"` | `"ollama"` | Inference runtime |

**Example response:**
```json
{
  "models": [
    { "name": "llama3.2:3b", "size": 2019393189, "parameterSize": "3.2B", "quantization": "Q4_K_M", "family": "llama" }
  ],
  "count": 1
}
```

### `run_benchmark`

Run a full benchmark (performance + quality) on a local model.

| Param | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | *(required)* | Model name (e.g. `"llama3.2:3b"`) |
| `runtime` | `"ollama"` | `"ollama"` | Inference runtime |
| `perfOnly` | `boolean` | `false` | If `true`, measure performance only (skip quality) |

**Example response:**
```json
{
  "success": true,
  "model": "llama3.2:3b",
  "verdict": "GOOD",
  "globalScore": 65,
  "performance": {
    "tokensPerSecond": 42.5,
    "ttftMs": 120,
    "memoryUsedGB": 2.1,
    "memoryPercent": 13
  },
  "interpretation": "This model runs well on your hardware."
}
```

### `get_results`

Retrieve previous benchmark results stored locally.

| Param | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | *(optional)* | Filter by model name (substring match) |
| `runtime` | `"ollama"` | `"ollama"` | Inference runtime |

### `share_result`

Upload a result to the public MetriLLM leaderboard.

| Param | Type | Description |
|---|---|---|
| `resultFile` | `string` | Absolute path to the result JSON file |

**Required environment variables:**
- `METRILLM_SUPABASE_URL`
- `METRILLM_SUPABASE_ANON_KEY`
- `METRILLM_PUBLIC_RESULT_BASE_URL`

## Architecture

The MCP server is a thin wrapper around the existing MetriLLM CLI logic:

```
mcp/src/index.ts  → MCP entry point (stdio transport)
mcp/src/tools.ts  → Tool definitions + calls to CLI modules
    ↓
../src/core/      → CLI logic reused directly
../src/commands/  → CLI commands (bench, list)
```

No code duplication — the MCP server imports CLI modules directly.

## Supported Runtimes

| Runtime | Status |
|---|---|
| Ollama | Supported |
| LM Studio | Planned |
| MLX | Planned |
| llama.cpp | Planned |
| vLLM | Planned |

The `runtime` parameter is present on every tool to prepare for multi-runtime support. Unimplemented runtimes return a clear error.

## License

[Apache License 2.0](../LICENSE)
