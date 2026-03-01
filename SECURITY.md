# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in LLMeter, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, send an email to **security@llmeter.org** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Scope

The following are in scope:

- **CLI code** (`src/` directory) — command injection, arbitrary code execution, data exfiltration
- **Coding benchmark sandbox** (`src/benchmarks/coding.ts`) — VM escape, sandbox bypass
- **Upload mechanism** (`src/core/uploader.ts`) — data tampering, unauthorized access
- **Telemetry** (`src/core/telemetry.ts`) — unintended data collection

The following are out of scope:

- The public leaderboard website (separate repository)
- Supabase infrastructure (report to Supabase directly)
- Social engineering attacks

## Security Design

- **No secrets in source code**: All credentials are loaded from environment variables at runtime
- **Supabase anon key**: The anon key is intentionally public and relies on Row Level Security (RLS) for access control — public read + public insert, immutable rows
- **Coding sandbox**: LLM-generated code runs in a Node.js VM sandbox with `strings: false, wasm: false` and worker thread isolation
- **Telemetry**: Opt-in only, anonymous (hashed CPU+OS+arch), no personal data collected
