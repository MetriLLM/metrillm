---
name: llmeter
description: Benchmark local LLM models — measures performance (tok/s, TTFT, memory), quality (reasoning, math, coding, instruction following, structured output, multilingual), and computes a hardware fitness verdict. Works with Ollama.
argument-hint: "[model-name]"
author: MetriLLM
source: https://github.com/MetriLLM/metrillm
license: MIT
allowed-tools: Bash, Read
---

# LLMeter — Benchmark Local LLM Models

Benchmark any local LLM model directly from your AI coding assistant. Get a clear verdict on whether a model fits your hardware.

## Setup

1. Install and start [Ollama](https://ollama.com)
2. Pull a model: `ollama pull llama3.2:3b`

## Usage

### List available models

```bash
ollama list
```

### Run a full benchmark

```bash
npx llmeter bench --model $ARGUMENTS --json
```

This measures:
- **Performance**: tokens/second, time to first token, memory usage
- **Quality**: reasoning, math, coding, instruction following, structured output, multilingual
- **Fitness verdict**: EXCELLENT / GOOD / MARGINAL / NOT RECOMMENDED

A full benchmark takes 1-5 minutes depending on model size.

### Performance-only benchmark (faster)

```bash
npx llmeter bench --model $ARGUMENTS --perf-only --json
```

Takes about 30 seconds. Skips quality evaluation.

### View previous results

```bash
ls ~/.llmeter/results/
```

Read any JSON file to see full benchmark details.

### Share to public leaderboard

```bash
npx llmeter bench --model $ARGUMENTS --share
```

## Interpreting Results

| Verdict | Score | Meaning |
|---|---|---|
| EXCELLENT | >= 80 | Fast and accurate — great fit |
| GOOD | >= 60 | Solid — suitable for most tasks |
| MARGINAL | >= 40 | Usable but with tradeoffs |
| NOT RECOMMENDED | < 40 | Too slow or inaccurate |

Key metrics to highlight:
- `tokensPerSecond` > 30 = good for interactive use
- `ttft` < 500ms = responsive
- `memoryUsedGB` vs available RAM = will it fit?

## Tips

- Use `--perf-only` for quick tests
- Smaller models (1-3B) benchmark in ~30s, larger (7B+) in 2-5 min
- Close GPU-intensive apps before benchmarking
- Thinking models (Qwen3, etc.) generate many tokens and take longer
