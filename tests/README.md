# Test Suite Guide

This folder contains tests that protect both correctness and user trust.

## Environment

- Project tooling and runtime target Node 20+.

## CI

- Workflow: `.github/workflows/ci.yml`
- Automatic on push/PR: `typecheck`, `coverage`, `build`, `audit`.
- Optional smoke benchmark: run manually via `workflow_dispatch` with `run_ollama_smoke=true`.

## What we test and why

- `utils.test.ts`
  - Tests parsing, formatting, interpolation, and timeout helpers.
  - Interest: these helpers feed scoring and benchmark parsing; regressions here affect many modules.

- `scoring.test.ts`
  - Tests performance score, quality score, and final fitness verdict.
  - Interest: scoring determines model ranking and recommendation quality.

- `sandbox.test.ts`
  - Tests VM isolation for untrusted model-generated code.
  - Interest: this is a security boundary; failures can expose host environment data.

- `datasets.test.ts`
  - Tests shape, IDs, and consistency of benchmark datasets.
  - Interest: invalid datasets produce invalid benchmark outcomes.

- `coding-eval.test.ts`
  - Validates coding dataset expected outputs against known-good implementations.
  - Interest: guards against incorrect benchmark ground truth.

- `ui.test.ts`
  - Tests banner/tables/verdict rendering functions.
  - Interest: protects CLI usability and avoids output regressions.

- `exporter.test.ts`
  - Tests JSON/CSV/Markdown exports.
  - Interest: ensures results are shareable and consumable by external tools.

- `npm run test:e2e:smoke`
  - Runs a real Ollama smoke benchmark (default: perf-only on one local model, picks the smallest installed model unless `OLLAMA_SMOKE_MODEL` is set).
  - Interest: catches integration breakages between CLI flow, Ollama API, benchmark execution, and scoring output.
  - Behavior: in non-strict mode, unavailable/unstable local runtime conditions are skipped with warning; use `OLLAMA_SMOKE_STRICT=1` (or `npm run test:e2e:smoke:strict`) to fail in CI.

## Practical rule

When adding a new feature, add at least one test that explains:

1. What behavior is expected.
2. Why this behavior matters for users or benchmark integrity.
