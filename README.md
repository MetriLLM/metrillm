# LLMeter

[![CI](https://github.com/MetriLLM/metrillm/actions/workflows/ci.yml/badge.svg)](https://github.com/MetriLLM/metrillm/actions/workflows/ci.yml)

**Benchmark your local LLM models in one command.** Speed, quality, hardware fitness — with a shareable score and public leaderboard.

> Think Geekbench, but for local LLMs on your actual hardware.

```bash
npx llmeter@latest bench
```

## What You Get

- **Performance metrics**: tokens/sec, time to first token, memory usage, load time
- **Quality evaluation**: reasoning, coding, math, instruction following, structured output, multilingual (14 prompts, 6 categories)
- **Global score** (0-100): 40% hardware fit + 60% quality
- **Verdict**: EXCELLENT / GOOD / MARGINAL / NOT RECOMMENDED
- **One-click share**: `--share` uploads your result and gives you a public URL + leaderboard rank

## Real Benchmark Results

> From the [public leaderboard](https://metrillm.dev) — all results below were submitted with `llmeter bench --share`.

| Model | Machine | CPU | RAM | tok/s | TTFT | Global | Verdict |
|-------|---------|-----|-----|------:|-----:|-------:|---------|
| llama3.2:latest | Mac Mini | Apple M4 Pro | 64 GB | 98.9 | 125 ms | 77 | GOOD |
| mistral:latest | Mac Mini | Apple M4 Pro | 64 GB | 54.3 | 124 ms | 76 | GOOD |
| gemma3:4b | MacBook Air | Apple M4 | 32 GB | 35.9 | 303 ms | 72 | GOOD |
| gemma3:1b | MacBook Air | Apple M4 | 32 GB | 39.4 | 362 ms | 72 | GOOD |
| qwen3:1.7b | MacBook Air | Apple M4 | 32 GB | 37.9 | 3.1 s | 70 | GOOD |
| llama3.2:3b | MacBook Air | Apple M4 | 32 GB | 27.8 | 285 ms | 69 | GOOD |
| gemma3:12b | MacBook Air | Apple M4 | 32 GB | 12.3 | 656 ms | 67 | GOOD |
| phi4:14b | MacBook Air | Apple M4 | 32 GB | 11.1 | 515 ms | 65 | GOOD |
| mistral:7b | MacBook Air | Apple M4 | 32 GB | 13.6 | 517 ms | 61 | GOOD |
| deepseek-r1:14b | MacBook Air | Apple M4 | 32 GB | 10.8 | 30.0 s | 25 | NOT RECOMMENDED |

**Key takeaway**: Small models (1-4B) fly on Apple Silicon. Larger models (14B+) with thinking chains can choke even on capable hardware. [See full leaderboard &rarr;](https://metrillm.dev)

## Install

> Requires [Node 20+](https://nodejs.org/) and [Ollama](https://ollama.com/) running.

```bash
# Run directly (no install)
npx llmeter@latest bench

# Or install globally
npm i -g llmeter
llmeter bench

# Alternative package managers
pnpm dlx llmeter@latest bench
bunx llmeter@latest bench
```

## Usage

```bash
# Interactive mode — pick models from a menu
llmeter bench

# Benchmark a specific model
llmeter bench --model gemma3:4b

# Benchmark all installed models
llmeter bench --all

# Share your result (upload + public URL + leaderboard rank)
llmeter bench --share

# CI/non-interactive mode
llmeter bench --ci-no-menu --share

# Force unload after each model (useful for memory isolation)
llmeter bench --all --unload-after-bench

# Export results locally
llmeter bench --export json
llmeter bench --export csv
```

## How Scoring Works

**Hardware Fit Score** (0-100) — how well the model runs on your machine:
- Speed: 40% (tokens/sec relative to your hardware tier)
- TTFT: 30% (time to first token)
- Memory: 30% (RAM efficiency)

**Quality Score** (0-100) — how well the model answers:
- Reasoning: 20pts | Coding: 20pts | Instruction Following: 20pts
- Structured Output: 15pts | Math: 15pts | Multilingual: 10pts

**Global Score** = 40% Hardware Fit + 60% Quality

Hardware is auto-detected and scoring adapts to your tier (Entry/Balanced/High-End). A model hitting 10 tok/s on a 8GB machine scores differently than on a 64GB rig.

[Full methodology &rarr;](https://metrillm.dev/methodology)

## Submit Your Result

Every benchmark you share enriches the public leaderboard. No account needed.

```bash
llmeter bench --share
```

You'll get:
- A public URL for your result
- Your rank: "Top X% globally, Top Y% on [your CPU]"
- A share card for social media
- A challenge link to send to friends

[Compare your results on the leaderboard &rarr;](https://metrillm.dev)

## Development

```bash
npm ci
npm run ci:verify     # typecheck + tests + build
npm run dev           # run from source
npm run test:watch    # vitest watch mode
```

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request. All commits must include a DCO sign-off.

## License

[Apache License 2.0](LICENSE) — see [NOTICE](NOTICE) for trademark information.
