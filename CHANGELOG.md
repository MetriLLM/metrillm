# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-03-06

### Added

- Auto-update check at CLI startup — non-intrusive npm registry check (cached 24h, 3s timeout) with "Update" option in the interactive menu.
- Windows PowerShell execution policy detection and user-friendly warning.
- Reassuring message after Guru Meditation easter egg.
- Email privacy clarification at every prompt point.

### Fixed

- Preserve backend selection and harden perf/runtime metrics.
- UI code review — shared stripAnsi, email prompt loop, export error message.
- LM Studio memory estimates and measurement parity.
- Normalize hardware parsing and core display (threads vs cores).
- tok/s parity and stream timeout handling for LM Studio.

## [0.2.1] - 2026-03-04

### Fixed

- Upgrade systeminformation ^5.23.5 → ^5.31.2 — resolves 4 High supply-chain CVEs.
- Upgrade @modelcontextprotocol/sdk ^1.12.1 → ^1.27.1 — resolves 3 High supply-chain CVEs.
- MCP server now works zero-config — no environment variables needed for leaderboard upload.
- Fix MCP server version announcement (was stuck at 0.1.0).
- Harden LM Studio non-thinking detection (regex + system prompt improvements).

## [0.2.0] - 2026-03-03

### Added

- CPU load measurement during inference — surfaces the MLX vs GGUF/llama.cpp difference (avg + peak %).
- Bench environment context: thermal pressure, swap delta, battery status detection.
- LM Studio runtime backend with full CLI, menu, and MCP support.
- Homebrew formula (`Formula/metrillm.rb`) and tap installation support.
- DB rescore migration script for batch re-scoring of existing results.

### Changed

- Performance score reweighted from 40/30/30 to 50/20/30 (speed/TTFT/memory).
- Global score reweighted from 40/60 to 30/70 (hardware/quality).
- Default Supabase config embedded for zero-config upload.

### Fixed

- LM Studio streaming `evalDuration` now uses token timing for accurate tok/s.
- CLI exits cleanly after interactive menu quit.
- Experimental Node TS stripping gated behind env var.
- Trailing runtime control tokens stripped robustly.
- Model format derived per-model for LM Studio uploads.

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
