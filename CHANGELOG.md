# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Homebrew formula (`Formula/metrillm.rb`) and maintenance script (`scripts/update-homebrew-formula.sh`).
- README installation instructions for Homebrew tap usage (`brew tap MetriLLM/metrillm && brew install metrillm`).

## [0.1.0] - 2026-03-02

### Added

- Claude Code and Cursor plugins for easier IDE integration.
- MCP server support for tool-based integrations.
- Multi-backend support with runtime/backend metadata.
- Telemetry enabled by default with explicit opt-out support.

### Fixed

- Sandbox hardening for coding benchmark execution.
- Coding benchmark reliability improvements (including TS annotation stripping and subprocess robustness).
- ASCII banner and cross-terminal rendering portability.
- Stream stall detection and timeout resilience.

### Changed

- Project rename from `LLMeter` to `MetriLLM` across the codebase and docs.

### Performance

- Leaderboard ranking query optimized to a single RPC call instead of multiple count queries.
