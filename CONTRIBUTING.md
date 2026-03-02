# Contributing to MetriLLM

Thank you for your interest in contributing to MetriLLM! This document explains how to contribute and the requirements for submissions.

## How to Contribute

1. **Fork** the repository on GitHub.
2. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feat/my-feature main
   ```
3. **Make your changes** and write tests if applicable.
4. **Run the full CI check** locally before submitting:
   ```bash
   npm run ci:verify
   ```
5. **Commit with DCO sign-off** (see below).
6. **Open a Pull Request** against `main`.

## Developer Certificate of Origin (DCO)

All contributions to this project must be signed off under the [Developer Certificate of Origin v1.1](https://developercertificate.org/). By signing off, you certify that you have the right to submit the contribution under the project's open-source license.

### How to sign off

Add a `Signed-off-by` line to every commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

The easiest way is to use the `-s` flag when committing:

```bash
git commit -s -m "feat: add new benchmark category"
```

If you forget, you can amend your last commit:

```bash
git commit --amend -s --no-edit
```

Or sign off an entire branch interactively:

```bash
git rebase HEAD~N --signoff
```

**Pull requests with unsigned commits will not be merged.**

### Developer Certificate of Origin v1.1

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Code Style and Conventions

- **Language**: TypeScript (strict mode).
- **Module format**: ESM (`"type": "module"` in package.json).
- **Build tool**: tsup.
- **Test framework**: Vitest.
- **Node version**: 20+ (see `.nvmrc`).
- Keep functions small and focused. Prefer pure functions where possible.
- Use descriptive variable names. Avoid abbreviations.
- Write tests for new features and bug fixes.
- Run `npm run ci:verify` before submitting — it must pass.

## Reporting Issues

Use [GitHub Issues](https://github.com/MetriLLM/metrillm/issues) to report bugs or request features. Please include:
- Steps to reproduce the issue.
- Expected vs. actual behavior.
- Node version, OS, and hardware info if relevant.
