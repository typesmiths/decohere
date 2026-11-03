# 0002. Secrets come from the environment; Bitwarden supplies them

- **Status:** Accepted (2026-10-04)
- **Date:** 2026-10-03 · updated 2026-10-21

## Context

Decohere apps need secrets: database passwords, Auth0 settings, API keys. Until now they reached the app in several different ways:

- `@decohere/config` imported `dotenv/config`, so **importing the config package** silently read a `.env` file from the current folder;
- the scaffolder writes `.env` files, and pulling them from GCP Secret Manager had been proposed;
- the ledger app caches secrets from GCP Secret Manager into a temp `.env` file, and is moving to Bitwarden;
- Dev Container scripts copied npm and GitHub tokens between folders.

Secrets in plain files on disk get copied, committed by accident, and go stale. A side-effect import that reads a file is also the kind of hidden behaviour our architecture rules forbid ("library modules have no side effects on import").

## Decision

1. **The framework reads configuration only from the process environment** (plus non-secret YAML config files). No Decohere package reads a `.env` file on its own.
2. **Loading a file is an explicit choice on the command line.** The CLIs (`flux`, `forge`, `decohere`) accept `--env-file <file>` (must exist) and `--env-file-if-exists <file>`, which use Node's built-in `process.loadEnvFile`. `dotenv` is no longer a dependency.
3. **Bitwarden Secrets Manager is the recommended source of secrets:**
   - Local development: `bws run -- pnpm dev` injects secrets as environment variables for that one command. The only secret on a developer's machine is `BWS_ACCESS_TOKEN`.
   - CI: the `bitwarden/sm-action` GitHub Action.
   - Production: the platform's own secret injection (e.g. Cloud Run secrets as env vars), or `bws run`.
4. GCP Secret Manager in the scaffolder is not pursued.

## Consequences

- Apps that relied on `@decohere/config` loading `.env` must now ask for it. Scaffolded apps already do: their `dev` scripts use `flux serve --env-file-if-exists .env` until Scaffolder v2 (M6) removes generated `.env` files altogether.
- One rule everywhere: a value is in `process.env` or it isn't. Tests set environment variables directly.
- The repo itself needs no secrets to develop: tests use fixtures, publishing uses OIDC, and `gh` uses `GH_TOKEN`.
- We're not building a Bitwarden integration into the framework. `bws run` sits outside the app, so any other secret manager that can set environment variables works the same way.

## History

- 2026-10-03: Secrets come from the environment; Bitwarden supplies them (accepted 2026-10-04).
- 2026-10-21: Package names updated to the plain names of [ADR 0014](0014-package-names.md). The decision is unchanged.
