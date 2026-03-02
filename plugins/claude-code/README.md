# MetriLLM Plugin for Claude Code

Benchmark local LLM models directly from Claude Code. Measures performance (tok/s, TTFT, memory), quality (reasoning, math, coding, instruction following, structured output, multilingual), and computes a hardware fitness verdict.

## Installation

```bash
# Test locally
claude --plugin-dir ./plugins/claude-code

# Or install from the marketplace (when available)
claude plugin install metrillm
```

## What's included

| Component | Description |
|---|---|
| **MCP Server** | `metrillm-mcp` — 4 tools: `list_models`, `run_benchmark`, `get_results`, `share_result` |
| **Skill: /metrillm:benchmark** | Run a full benchmark on any local model |
| **Skill: metrillm-guide** | Background context, auto-activated when relevant |
| **Agent: benchmark-advisor** | Read-only agent that analyzes and compares results |

## Usage

### Benchmark a model

```
/metrillm:benchmark llama3.2:3b
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

## Requirements

- [Ollama](https://ollama.ai) installed and running
- At least one model pulled (`ollama pull llama3.2:3b`)
- Node.js >= 20

## Links

- [MetriLLM CLI](https://github.com/MetriLLM/metrillm)
- [Public Leaderboard](https://metrillm.dev/leaderboard)
- [MCP Server docs](https://github.com/MetriLLM/metrillm/tree/main/mcp)
