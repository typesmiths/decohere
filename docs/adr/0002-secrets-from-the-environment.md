# 0002. Secrets come from the environment; Bitwarden supplies them

- **Status:** Accepted
- **Date:** 2026-10-03 · updated 2026-11-06

## Context

Apps need secrets: database passwords, Auth0 settings, API keys. They used to arrive several ways. Importing `@decohere/config` silently read a `.env` file from the current folder (via `dotenv/config`), the scaffolder wrote `.env` files, and apps cached secrets from GCP Secret Manager into temporary `.env` files.

Secrets in files on disk get copied, committed by accident and go stale. An import that reads a file is also a side effect on import, which the [architecture rules](../architecture/README.md#1-keep-the-product-pure-of-its-host) forbid.

## Decision

1. **The framework reads configuration only from the process environment** (plus non-secret YAML config files). No Decohere package reads a `.env` file on its own.
2. **Loading a file is an explicit CLI flag.** `flux`, `forge` and `decohere` accept `--env-file <file>` (must exist) and `--env-file-if-exists <file>`, using Node's `process.loadEnvFile`. `dotenv` is not a dependency.
3. **Bitwarden Secrets Manager is the recommended source for apps:**
   - Local development: `bws run -- pnpm dev` injects secrets for that one command. The only secret on a developer's machine is `BWS_ACCESS_TOKEN`.
   - CI: the `bitwarden/sm-action` GitHub Action.
   - Production: the platform's secret injection (e.g. Cloud Run secrets as env vars), or `bws run`.
4. GCP Secret Manager in the scaffolder is not pursued.

## Consequences

- One rule everywhere: a value is in `process.env` or it isn't. Tests set environment variables directly.
- Scaffolded apps ask for their `.env` explicitly: their `dev` script is `flux serve --env-file-if-exists .env`, until a later release stops generating `.env` files. That is deferred: it comes with no password on the local database and a real secret store (OS key stores or a built-in Bitwarden provider).
- This repo's CI stores no secrets: tests use fixtures, npm publishing uses Trusted Publishing (OIDC), and GHCR and `gh` use the workflow's `GITHUB_TOKEN`.
- There is no Bitwarden integration in the framework. `bws run` sits outside the app, so any secret manager that sets environment variables works the same way.

## History

- 2026-10-03: Secrets come from the environment; Bitwarden supplies them (accepted 2026-10-04).
- 2026-11-04: The repo's CI stores no secrets: npm publishes through Trusted Publishing and GHCR through `GITHUB_TOKEN`.
- 2026-11-06: Removing `.env` from scaffolded apps moved out of Scaffolder v2 and deferred.
