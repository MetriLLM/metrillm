# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

Always respond in French. Code, comments, commit messages, and technical identifiers remain in English.

## Project

LLMeter — CLI benchmark tool for local Ollama LLM models. Measures performance (tok/s, TTFT, memory), quality (reasoning, math, coding, instruction following, structured output, multilingual), and computes a hardware fitness verdict.

## Commands

```bash
npm run build          # tsup → dist/index.mjs (ESM, Node20, bundled)
npm run dev            # Run from source via tsx
npm run typecheck      # tsc --noEmit
npm run test           # vitest run
npm run test:watch     # vitest watch
npm run test:coverage  # vitest with v8 coverage (thresholds enforced)
npm run ci:verify      # typecheck + test:coverage + build (full CI check)
npm run test:e2e:smoke # Real Ollama integration test (requires running Ollama)
```

Run a single test file: `npx vitest run tests/scoring.test.ts`
Run a single test by name: `npx vitest run -t "test name pattern"`

## Architecture

**Entry point**: `src/index.ts` — Commander.js CLI with interactive menu fallback.

**Benchmark flow** (`src/commands/bench.ts`):
1. Detect hardware (`src/core/hardware.ts`) via systeminformation
2. List/select Ollama models (`src/core/ollama-client.ts`)
3. Run performance benchmark (5 prompts + warmup) → `src/benchmarks/performance.ts`
4. Run quality benchmarks (6 categories) → `src/benchmarks/*.ts` against `src/datasets/*.json`
5. Compute scores → `src/scoring/` (performance-scorer, quality-scorer, fitness)
6. Display results → `src/ui/` (tables, verdict, colors)
7. Persist locally → `~/.llmeter/results/`
8. Optional upload → Supabase via `src/core/uploader.ts`

**Scoring system**:
- Performance score (0-100): speed (40pts) + TTFT (30pts) + memory (30pts), hardware-adaptive tuning by profile (ENTRY/BALANCED/HIGH-END)
- Quality score (0-100): weighted categories — reasoning/coding/instruction=20pts, structured-output/math=15pts, multilingual=10pts. Time penalties for slow responses.
- Global score: 40% performance + 60% quality
- Verdicts: EXCELLENT (>=80) | GOOD (>=60) | MARGINAL (>=40) | NOT RECOMMENDED (<40 or disqualified)

**Key directories**:
- `src/benchmarks/` — Individual benchmark runners (performance + 6 quality categories)
- `src/datasets/` — Ground truth JSON fixtures for quality evaluation
- `src/scoring/` — Score computation and fitness verdict logic
- `src/core/` — Infrastructure (Ollama client, hardware detection, storage, upload, export)
- `src/ui/` — CLI output formatting (tables, spinners, menus, verdict display)
- `src/commands/` — CLI command handlers (bench, list, menu)

## Database

Supabase (PostgreSQL) with RLS — public read + public insert, immutable rows. Table `benchmarks` with indexed columns for leaderboard queries. Deduplication via `raw_log_hash` unique constraint. The anon key is embedded in `src/core/uploader.ts`.

## Companion repo

The public leaderboard website lives in a separate private repo: `MetriLLM/metrillm-web` (Astro SSR + React + Tailwind, deployed on Netlify at https://metrillm.dev). Types in `src/types.ts` are shared — changes here must be mirrored there.

## Coding benchmark security

`src/benchmarks/coding.ts` runs LLM-generated code in a Node VM sandbox with `strings: false, wasm: false`. Uses worker thread fallback. Changes to this file require extra care.

## CI

GitHub Actions (`.github/workflows/ci.yml`): typecheck + coverage + build + audit on every push/PR. Ollama smoke test is manual-only (`run_ollama_smoke=true`). Node 20 required (see `.nvmrc`).
