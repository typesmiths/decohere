# Architecture decision records

Short records of the decisions that shape Decohere: what we decided, why, and what it costs. **One record per topic** ([0001](0001-record-architecture-decisions.md)). Read the relevant one before changing how something works.

The current rules live in [architecture/](../architecture/) and [style/](../style/). An ADR is **why** we chose them and what we rejected, not a second rule book. How-tos belong in [testing/how-tos/](../testing/how-tos/).

## When to write one

When the reasoning would otherwise disappear into a PR description:

- a new package, a retired name or a layering change;
- class vs namespace vs loose function, or a reversal;
- host decoupling, test strategy or CLI shape that other packages must follow;
- a rejected alternative someone will propose again in six months.

Not for a bug fix, a private rename or a how-to.

## Changing a decision

Update the topic's record **in the same PR as the code**: rewrite what no longer holds, add a dated **History** line, bump _updated_. Never a quiet edit. If a standing rule changes, amend [architecture/](../architecture/) or [style/](../style/) in that PR too.

## A new topic

1. Copy [template.md](template.md) to `NNNN-short-kebab-title.md` with the next unused four-digit number. Numbers are never reused.
2. Fill **Context**, **Decision**, **Consequences** and start **History**. Status is `Proposed` while the PR is open, `Accepted` when it merges.
3. Add a row to the index below.

## Merging and splitting

- When topics drift together, merge them. The earliest record still in force keeps its number; delete the others (git keeps them), repoint references, and list the old numbers on the survivor's **Merges** line.
- A number with no file was merged: `grep -l 0035 docs/adr/*.md` finds the record that lists it.
- When a record passes about two pages, split it by topic.

## Index

### Process and platform

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | ADRs live in `docs/adr/`, one record per topic, each with a History | Accepted |
| [0002](0002-secrets-from-the-environment.md) | Secrets come only from the process environment; `.env` files load only via `--env-file`; Bitwarden recommended | Accepted |
| [0023](0023-config-layers.md) | Config is layered: class defaults, then sources in order. `EnvDataSource` maps `SECTION__KEY`, and a class's `static schema` is checked with errors that never show a value | Accepted |
| [0003](0003-no-changesets-until-public-release.md) | No changesets for now | Accepted |
| [0004](0004-oxlint-and-prettier.md) | Lint with oxlint, format with Prettier | Accepted |
| [0009](0009-agent-instructions-in-agents-md.md) | Agent instructions live in `AGENTS.md`; `.claude/CLAUDE.md` imports it | Proposed |
| [0014](0014-package-names.md) | Products keep their names (forge, flux, crucible, scribe); support libraries are named for what they do; hosting moves into `core` | Proposed |
| [0019](0019-dev-versions-from-the-ci-run.md) | Dev versions come from the CI run, chosen once in CI; Publish reads them from the build; tags only record what shipped | Accepted |
| [0020](0020-test-the-real-install-before-publishing.md) | `main` tests the real install from a temporary registry before publishing; PRs run the quicker checks | Accepted |
| [0021](0021-esm-only-packages.md) | Published packages are ESM only; forge's default release build makes ESM and types |
| [0022](0022-where-scaffolding-runs.md) | Scaffolding runs where its tools are: directly in a Decohere Dev Container, otherwise in the scaffolder image with nothing shared and the project copied out | Accepted |

### Build and packaging

| ADR | Decision | Status |
|---|---|---|
| [0006](0006-forge-package-deployables.md) | `forge package` puts a deployable and the libraries it reaches in one `.package/` folder, installed with npm, no symlinks | Proposed |
| [0012](0012-workspace-package-resolution.md) | Workspace packages resolve to source from the workspace aliases; `forge paths` generates them for `tsc` | Proposed |
| [0015](0015-core-devkit-testing.md) | `core` is the runtime base (only `reflect-metadata`, no import side effects); CLI base is `devkit`, test helpers are `testing` | Proposed |
| [0017](0017-dependency-manifests-from-imports.md) | `forge dependencies sync` writes package manifests from imports; the root owns every version; peers are declared by name | Proposed |
| [0018](0018-flux-run-loads-only-what-running-needs.md) | `flux run` loads only what running a file needs: no TypeScript compiler, no rxjs, `@decohere/forge/transpile` not the whole of forge; Node's compile cache on; no bundler yet | Accepted |

### Data

| ADR | Decision | Status |
|---|---|---|
| [0011](0011-database-bootstrap.md) | Database bootstrap: `auth: trust` is declared, never inferred; schemas are created and granted on; each database once, granting only what is missing | Proposed |
| [0024](0024-default-orm.md) | Proposed: MikroORM is the default ORM, mapped outside the domain; TypeORM is removed once its adapter ships; Drizzle and TypeORM 1.x were the alternatives | Proposed |

### Dependency injection

| ADR | Decision | Status |
|---|---|---|
| [0013](0013-container-keys-and-lifetimes.md) | The container keys services by identity; missing dependencies, cycles and captive dependencies throw at resolve; `@optional()` marks what may be absent | Proposed |

### Logging

| ADR | Decision | Status |
|---|---|---|
| [0016](0016-scribe-on-any-runtime.md) | Scribe's facade needs only `console`; writers are adapter packages; adapters redact, not the facade | Proposed |

### HTTP and hosting

| ADR | Decision | Status |
|---|---|---|
| [0005](0005-server-sent-events-in-http.md) | Server-sent events via `@Sse()` on a route, one-way, before WebSockets | Accepted |
| [0007](0007-serving-a-built-ui-from-http.md) | `statics` serves a module's built UI: outside the pipeline and rate limit, cached by file kind, SPA fallback | Proposed |
| [0008](0008-response-compression-in-http.md) | Responses are compressed by default with the `compression` setting, a thin wrapper around `@fastify/compress` | Proposed |
| [0010](0010-hosted-services.md) | Background work runs as hosted services, started before HTTP listens and stopped before the container is disposed | Proposed |
