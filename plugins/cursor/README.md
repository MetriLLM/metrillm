# LLMeter Plugin for Cursor

Benchmark local LLM models directly from Cursor. Measures performance (tok/s, TTFT, memory), quality (reasoning, math, coding, instruction following, structured output, multilingual), and computes a hardware fitness verdict.

## Installation

Copy the plugin directory to your Cursor plugins folder:

```bash
cp -r plugins/cursor ~/.cursor/plugins/local/llmeter
```

Or install from the Cursor marketplace when available.

## What's included

| Component | Description |
|---|---|
| **MCP Server** | `llmeter-mcp` — 4 tools: `list_models`, `run_benchmark`, `get_results`, `share_result` |
| **Skill: /benchmark** | Run a full benchmark on any local model |
| **Skill: llmeter-guide** | Background context auto-activated when relevant |
| **Agent: benchmark-advisor** | Read-only agent that analyzes and compares results |
| **Rule: model-selection** | Suggests benchmarking when you discuss local model choices |

## Usage

### Benchmark a model

```
/llmeter:benchmark llama3.2:3b
```

### Ask the advisor

```
@benchmark-advisor Which of my tested models is best for coding?
```

### Use MCP tools directly

The MCP server exposes 4 tools:
- `list_models` — List available Ollama models
- `run_benchmark` — Run a benchmark (with optional `perfOnly` flag)
- `get_results` — Retrieve previous results (with optional model filter)
- `share_result` — Upload a result to the public leaderboard

### Auto-suggestion

The `llmeter-model-selection` rule will suggest benchmarking when you discuss local model selection, performance, or hardware fitness.

## Requirements

- [Ollama](https://ollama.ai) installed and running
- At least one model pulled (`ollama pull llama3.2:3b`)
- Node.js >= 20

## Links

- [LLMeter CLI](https://github.com/MetriLLM/metrillm)
- [Public Leaderboard](https://llmeter.app/leaderboard)
- [MCP Server docs](https://github.com/MetriLLM/metrillm/tree/main/mcp)
