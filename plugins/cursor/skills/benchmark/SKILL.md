---
name: benchmark
description: Benchmark a local LLM model with MetriLLM. Measures performance (tok/s, TTFT, memory) and quality (reasoning, math, coding, instruction following, structured output, multilingual). Use when the user wants to test, compare, or evaluate a local model.
argument-hint: "[model-name]"
allowed-tools: Bash, Read, Glob, Grep
---

# Benchmark a Local LLM Model

Run an MetriLLM benchmark on a locally available model. This skill handles setup verification, model selection, benchmark execution, and result interpretation.

## Prerequisites Check

Before running any benchmark, verify the environment:

1. **Ollama running**: Run `ollama list` to check. If it fails, tell the user to start Ollama first.
2. **MetriLLM available**: If the MetriLLM MCP server is connected, use the MCP tools directly. Otherwise, check if `npx metrillm` works.

## Workflow

### Step 1 — Select the model

If `$ARGUMENTS` is provided, use it as the model name. Otherwise:

- **With MCP**: Use the `list_models` tool to list available models.
- **Without MCP**: Run `ollama list`.

Help the user pick a model if they're unsure. Smaller models (1-3B) benchmark faster (~30s). Larger models (7B+) take 2-5 minutes.

### Step 2 — Run the benchmark

**With MCP** (preferred):
Use the `run_benchmark` tool with the model name. Set `perfOnly: true` for performance-only (faster).

**Without MCP**:
```bash
npx metrillm bench --model <model-name> --json
```

For performance-only (skip quality tests, much faster):
```bash
npx metrillm bench --model <model-name> --perf-only --json
```

### Step 3 — Interpret results

The benchmark produces a JSON result with:

| Metric | What it means |
|---|---|
| `performance.tokensPerSecond` | Generation speed. >30 tok/s = good for interactive use |
| `performance.ttft` | Time to first token in ms. <500ms = responsive |
| `performance.memoryUsedGB` | RAM/VRAM consumed during inference |
| `fitness.verdict` | EXCELLENT / GOOD / MARGINAL / NOT RECOMMENDED |
| `fitness.globalScore` | 0-100 composite score (30% perf + 70% quality) |
| `fitness.interpretation` | Human-readable summary of the verdict |

Present the results in a clear, concise format. Highlight the verdict prominently.

### Step 4 — Compare (optional)

If the user wants to compare models:

- **With MCP**: Use the `get_results` tool to retrieve previous results.
- **Without MCP**: Read JSON files from `~/.metrillm/results/`.

Compare side-by-side on key metrics.

### Step 5 — Share (optional)

If the user wants to share results to the public leaderboard:

- **With MCP**: Use the `share_result` tool with the result file path.
- **Without MCP**: `npx metrillm bench --model <model-name> --share`

Requires `METRILLM_SUPABASE_URL` and `METRILLM_SUPABASE_ANON_KEY` environment variables.

## Tips

- Use `--perf-only` / `perfOnly: true` for quick tests when quality scoring isn't needed
- Qwen3 and other "thinking" models generate many tokens and take significantly longer
- Close other GPU-intensive applications before benchmarking for accurate results
- Run the same model twice to verify consistency — first run may be slower due to model loading
