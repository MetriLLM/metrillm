# Recommended Branch Protection (GitHub)

Apply these settings on the `main` branch in:

`Settings` -> `Branches` -> `Add branch protection rule`

## Rule

- Branch name pattern: `main`

## Recommended options

- `Require a pull request before merging`: enabled
- `Require approvals`: `1` minimum
- `Dismiss stale pull request approvals when new commits are pushed`: enabled
- `Require status checks to pass before merging`: enabled
- `Require branches to be up to date before merging`: enabled
- Required status check: `Verify (Node 20)`
- `Require conversation resolution before merging`: enabled
- `Do not allow bypassing the above settings`: enabled (for strict governance)

## Optional stricter settings

- `Require linear history`: enabled
- `Require signed commits`: enabled
- `Include administrators`: enabled

## Notes about Ollama smoke

The `Ollama Smoke (manual)` job is designed for manual runtime validation.
It is intentionally not a required status check on every PR, because it depends on downloading and running model weights.
