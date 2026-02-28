# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the CLI and benchmark logic.
- `src/benchmarks/` holds benchmark runners (performance, reasoning, coding, etc.).
- `src/core/` contains integrations and persistence (`ollama-client`, exporter, store, uploader).
- `src/scoring/` computes hardware fit, quality, and final verdict.
- `src/ui/` renders CLI tables, menus, prompts, and verdict screens.
- `src/datasets/` stores benchmark datasets in JSON.
- `tests/` mirrors runtime behavior with unit/regression tests (`*.test.ts`).
- `scripts/` contains smoke/e2e helpers. `supabase/migrations/` tracks DB schema changes.

## Build, Test, and Development Commands
- `npm run dev` — run CLI from source (`tsx src/index.ts`).
- `npm run build` — build distributable CLI with `tsup` into `dist/`.
- `npm run typecheck` — strict TypeScript check (`tsc --noEmit`).
- `npm test` — run all Vitest tests once.
- `npm run test:coverage` — run tests with V8 coverage report.
- `npm run test:watch` — interactive test mode for local iteration.
- `npm run ci:verify` — full local CI gate: typecheck + coverage + build.
- `npm run security:audit` — dependency vulnerability audit.

## Coding Style & Naming Conventions
- Language: TypeScript (ESM, Node 20+).
- Indentation: 2 spaces; keep functions short and explicit.
- Naming: `camelCase` for variables/functions, `PascalCase` for types/interfaces, kebab-case filenames (e.g., `performance-scorer.ts`).
- Prefer small pure helpers in `src/utils.ts` and domain logic in module-specific files.

## Testing Guidelines
- Framework: Vitest (`tests/*.test.ts`).
- Add focused regression tests for every bug fix (especially scoring, parsing, menu flow, sandboxing).
- Keep tests deterministic; avoid external network dependency unless using dedicated smoke scripts.
- Before opening a PR, run: `npm run ci:verify` and `npm run security:audit`.

## Commit & Pull Request Guidelines
- Follow existing commit style: imperative, concise subject (e.g., `Improve robustness: ...`, `Add migration for ...`).
- One logical change per commit when possible.
- PRs should include:
  - What changed and why.
  - Risk/impact notes (CLI behavior, scoring, schema, security).
  - Test evidence (commands run, key outputs).
  - Screenshots/terminal captures for UI/menu changes.

## Security & Configuration Tips
- Use Node `>=20` (`.nvmrc` is `20`).
- Do not commit secrets; keep local overrides in environment variables.
- `OLLAMA_HOST` can be used to target non-default Ollama endpoints.
