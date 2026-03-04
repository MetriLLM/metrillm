---
name: metrillm-guide
description: Background context about MetriLLM benchmark tool. Activates when the user asks about local LLM performance, model comparison, hardware fitness, or benchmarking. Provides guidance on using MetriLLM CLI and interpreting results.
user-invocable: false
---

# MetriLLM — Local LLM Benchmark Tool

MetriLLM benchmarks local LLM models running on Ollama. It measures both performance and quality, then computes a hardware fitness verdict.

## When to Suggest MetriLLM

Suggest using MetriLLM when the user:
- Asks which local model is best for their hardware
- Wants to compare models (speed, quality, or both)
- Needs to know if a model fits their RAM/VRAM
- Asks about tokens/second, TTFT, or inference speed
- Wants to evaluate model quality (reasoning, coding, math)

## Quick Reference

**With MCP** (if MetriLLM MCP server is connected, prefer these):
- `list_models` — List available Ollama models
- `run_benchmark` — Run a benchmark (set `perfOnly: true` for speed-only)
- `get_results` — Retrieve previous results
- `share_result` — Upload to public leaderboard

**Without MCP** (CLI fallback):
```bash
# List available models
ollama list

# Full benchmark (perf + quality, 1-5 min)
metrillm bench --model <name>

# Performance only (30s)
metrillm bench --model <name> --perf-only

# View previous results
ls ~/.metrillm/results/

# Share to public leaderboard
metrillm bench --model <name> --share
```

## Verdict Scale

| Verdict | Score | Meaning |
|---|---|---|
| EXCELLENT | >= 80 | Fast and accurate — great fit for this hardware |
| GOOD | >= 60 | Solid performance — suitable for most tasks |
| MARGINAL | >= 40 | Usable but with tradeoffs (slow or low quality) |
| NOT RECOMMENDED | < 40 | Too slow or too inaccurate for practical use |
