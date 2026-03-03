# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

Always respond in French. Code, comments, commit messages, and technical identifiers remain in English.

## Project

MetriLLM — CLI benchmark tool for local LLM models (Ollama and LM Studio). Measures performance (tok/s, TTFT, memory, CPU load), quality (reasoning, math, coding, instruction following, structured output, multilingual), and computes a hardware fitness verdict.

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
7. Persist locally → `~/.metrillm/results/`
8. Optional upload → Supabase via `src/core/uploader.ts`

**Scoring system**:
- Performance score (0-100): speed (50pts) + TTFT (20pts) + memory (30pts), hardware-adaptive tuning by profile (ENTRY/BALANCED/HIGH-END)
- Quality score (0-100): weighted categories — reasoning/coding/instruction=20pts, structured-output/math=15pts, multilingual=10pts. Time penalties for slow responses.
- Global score: 30% performance + 70% quality
- Verdicts: EXCELLENT (>=80) | GOOD (>=60) | MARGINAL (>=40) | NOT RECOMMENDED (<40 or disqualified)

**Key directories**:
- `src/benchmarks/` — Individual benchmark runners (performance + 6 quality categories)
- `src/datasets/` — Ground truth JSON fixtures for quality evaluation
- `src/scoring/` — Score computation and fitness verdict logic
- `src/core/` — Infrastructure (runtime clients, hardware detection, storage, upload, export)
- `src/ui/` — CLI output formatting (tables, spinners, menus, verdict display)
- `src/commands/` — CLI command handlers (bench, list, menu)
- `mcp/` — MCP server for IDE integration (separate `package.json`, published as `metrillm-mcp`)
- `plugins/` — IDE plugins (Claude Code, Cursor) with skills, agents, and rules

## Database

Supabase (PostgreSQL) with RLS — public read + public insert, immutable rows. Table `benchmarks` with indexed columns for leaderboard queries. Deduplication via `raw_log_hash` unique constraint. Upload credentials are provided via env vars (`METRILLM_SUPABASE_URL`, `METRILLM_SUPABASE_ANON_KEY`).

## Companion repo

The public leaderboard website lives in a separate repo: `MetriLLM/metrillm-web` (Astro SSR + React + Tailwind, deployed at https://metrillm.dev). Types in `src/types.ts` are shared — changes here must be mirrored there.

## Coding benchmark security

`src/benchmarks/coding.ts` runs LLM-generated code in a Node VM sandbox with `strings: false, wasm: false`. Uses worker thread fallback. Changes to this file require extra care.

## Multi-runtime

Supports **Ollama** (`src/core/ollama-client.ts`) and **LM Studio** (`src/core/lm-studio-client.ts`). Runtime abstraction via `src/core/runtime.ts` — all benchmark code calls `generateStream()`, `listModels()`, etc. from runtime.ts, never from clients directly.

## CI

GitHub Actions (`.github/workflows/ci.yml`): typecheck + coverage + build + audit on every push/PR. Ollama smoke test is manual-only (`run_ollama_smoke=true`). Node 20 required (see `.nvmrc`).

**Known CI constraint**: Root tests import `mcp/src/tools.ts` which depends on `zod`. Since CI only runs `npm ci` at root level, `zod` must be in root `devDependencies` (not just in `mcp/package.json`). If adding new MCP dependencies, also add them to root `devDependencies`.

## Release process

Release is triggered by pushing a `v*` tag. Workflow: `.github/workflows/release.yml`.

**Distribution channels** (all must be updated for each release):

| # | Channel | How | Auto? |
|---|---------|-----|-------|
| 1 | `package.json` version bump | Manual edit | No |
| 2 | `mcp/package.json` version bump | Manual edit | No |
| 3 | `mcp/server.json` version bump | Manual edit | No |
| 4 | `plugins/claude-code/.claude-plugin/plugin.json` version | Manual edit | No |
| 5 | `plugins/cursor/.cursor-plugin/plugin.json` version | Manual edit | No |
| 6 | `CHANGELOG.md` | Move [Unreleased] to [x.y.z] section | No |
| 7 | `README.md` | Update version references if any | No |
| 8 | Commit + tag `vX.Y.Z` + push | `git tag vX.Y.Z && git push origin main --tags` | No |
| 9 | npm `metrillm` | Release workflow (auto on tag push) | Yes |
| 10 | npm `metrillm-mcp` | Release workflow (auto on tag push) | Yes |
| 11 | GitHub Release | Release workflow (auto, extracts CHANGELOG) | Yes |
| 12 | Smoke tests (Ubuntu/macOS/Windows) | Release workflow (auto) | Yes |
| 13 | Homebrew formula | `./scripts/update-homebrew-formula.sh X.Y.Z` then commit | No |
| 14 | MCP Registry | `cd mcp && mcp-publisher publish` (requires `mcp-publisher login github` first) | No |

**Release checklist order**:
1. Bump all versions (steps 1-7), commit
2. Run `npm run ci:verify` locally before tagging
3. Tag and push (step 8) — triggers automated steps 9-12
4. Wait for Release workflow to be fully green
5. Run Homebrew formula update (step 13), commit and push
6. Publish to MCP Registry (step 14)

**GitHub Device Flow via Playwright**: The per-character code input on `github.com/login/device` requires `keyboard.type('CODE', { delay: 100 })` — `fill()` does not work on these individual character textboxes.
