# LLMeter

[![CI](https://github.com/MetriLLM/metrillm/actions/workflows/ci.yml/badge.svg)](https://github.com/MetriLLM/metrillm/actions/workflows/ci.yml)

CLI benchmark for local Ollama models focused on host hardware fit and task quality, with a combined global verdict.

## Requirements

- Node 20+
- Ollama installed and running for model benchmarks

## Quick Start

```bash
npm ci
npm run ci:verify
```

```bash
# Interactive mode
npm run dev
```

```bash
# CI/non-interactive mode (no menu)
npx llmeter --ci-no-menu
```

```bash
# Real integration smoke test (local Ollama)
npm run test:e2e:smoke
```

## CI

- Workflow file: `.github/workflows/ci.yml`
- Automatic on push/PR: typecheck, tests, build, audit
- Optional manual job: strict Ollama smoke benchmark

Branch protection recommendations are documented in:

- `.github/branch-protection.md`

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request. All commits must include a DCO sign-off.

## License

This project is licensed under the [Apache License 2.0](LICENSE).

See the [NOTICE](NOTICE) file for trademark information and additional attribution details.
