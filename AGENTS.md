# AGENTS.md — MetriLLM CLI (`MetriLLM/metrillm`)

Guidelines for AI agents and contributors working on this repository.

## Project Overview

MetriLLM is an open-source CLI tool that benchmarks local LLM models running on Ollama or LM Studio. It measures performance (tok/s, TTFT, memory, CPU load) and quality (reasoning, math, coding, instruction following, structured output, multilingual), then computes a hardware fitness verdict.

- **License**: Apache 2.0
- **Language**: TypeScript (ESM, Node 20+)
- **Runtimes**: Ollama (`src/core/ollama-client.ts`), LM Studio (`src/core/lm-studio-client.ts`), abstracted via `src/core/runtime.ts`
- **Companion repo**: `MetriLLM/metrillm-web` (private) — leaderboard website at `metrillm.dev`

## Project Structure

```
src/
  benchmarks/       # Benchmark runners (performance + 6 quality categories)
  commands/         # CLI command handlers (bench, list)
  core/             # Infrastructure (Ollama client, hardware detection, storage, upload, telemetry)
  datasets/         # Ground truth JSON fixtures for quality evaluation
  scoring/          # Score computation (performance, quality, fitness verdict)
  ui/               # CLI output (tables, spinners, menus, verdict display)
  index.ts          # Entry point — Commander.js CLI with interactive menu fallback
  types.ts          # Shared types (also used by companion website)
tests/              # Vitest unit/regression tests (mirrors src/ structure)
mcp/                # MCP server for IDE integration (Claude Code, Cursor, etc.)
plugins/            # IDE plugins (Claude Code, Cursor)
scripts/            # Smoke/e2e helpers
docs/               # Technical documentation
```

## Commands

```bash
npm run dev            # Run CLI from source (tsx)
npm run build          # Build distributable CLI (tsup → dist/index.mjs)
npm run typecheck      # tsc --noEmit
npm test               # Vitest run (all tests)
npm run test:watch     # Vitest watch mode
npm run test:coverage  # Vitest with V8 coverage (thresholds enforced)
npm run ci:verify      # Full CI gate: typecheck + coverage + build
npm run security:audit # Dependency vulnerability audit
npm run test:e2e:smoke # Real Ollama integration test (requires running Ollama)
```

Run a single test: `npx vitest run tests/scoring.test.ts`

## Coding Conventions

- **Indentation**: 2 spaces
- **Naming**: `camelCase` for variables/functions, `PascalCase` for types/interfaces, kebab-case filenames
- **Modules**: Small pure helpers in `src/utils.ts`, domain logic in module-specific files
- **Imports**: ESM only (`import`/`export`), no CommonJS

## Testing

- **Framework**: Vitest (`tests/*.test.ts`)
- Add focused regression tests for every bug fix (especially scoring, parsing, menu flow, sandboxing)
- Keep tests deterministic — no external network calls unless in dedicated smoke scripts
- Before opening a PR: `npm run ci:verify && npm run security:audit`

## Commit Guidelines

- Imperative, concise subject (e.g., `fix: handle timeout in performance benchmark`)
- One logical change per commit
- PRs should include: what changed, why, risk/impact notes, test evidence

## Security

- **Node >= 20** required (`.nvmrc`)
- Never commit secrets — use environment variables (`METRILLM_SUPABASE_URL`, `METRILLM_SUPABASE_ANON_KEY`)
- `src/benchmarks/coding.ts` runs LLM-generated code in a Node VM sandbox — changes require extra care
- `OLLAMA_HOST` env var targets non-default Ollama endpoints

## Database

Supabase (PostgreSQL) with RLS — public read + public insert, immutable rows. Upload credentials via env vars. Schema is not tracked in this repo.

## CI

GitHub Actions (`.github/workflows/ci.yml`): typecheck + coverage + build + audit on every push/PR. Ollama smoke test is manual-only.

**Important**: Root tests import code from `mcp/src/` — any dependency used there (e.g., `zod`) must also be listed in root `devDependencies`, because CI only runs `npm ci` at root level.

## Release

Triggered by pushing a `v*` git tag. Workflow: `.github/workflows/release.yml`.

**Automated** (via release workflow): npm publish (`metrillm` + `metrillm-mcp`), GitHub Release with changelog extraction, smoke tests on Ubuntu/macOS/Windows.

**Manual steps required before tagging**:
1. Bump version in: `package.json`, `mcp/package.json`, `mcp/server.json`, `plugins/claude-code/.claude-plugin/plugin.json`, `plugins/cursor/.cursor-plugin/plugin.json`
2. Update `CHANGELOG.md` (move [Unreleased] items to versioned section)
3. Run `npm run ci:verify` locally
4. Commit, tag (`git tag vX.Y.Z`), push tag

**Manual steps required after release workflow completes**:
5. Homebrew: `./scripts/update-homebrew-formula.sh X.Y.Z`, commit and push
6. MCP Registry: `cd mcp && mcp-publisher publish` (requires prior `mcp-publisher login github`)

**Distribution channels**: npm (metrillm), npm (metrillm-mcp), GitHub Release, Homebrew tap, MCP Registry, Claude Code plugin, Cursor plugin.
