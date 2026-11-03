# Architecture decision records

Short records of the decisions that shape Decohere: what we decided, why, and what it costs us. There is **one record per topic** ([0001](0001-record-architecture-decisions.md)). Read the relevant one before changing how something works.

The current rules live in [architecture/](../architecture/) and [style/](../style/). An ADR is **why** we chose them, and what we rejected. It is not a second rule book.

Testing how-tos stay in [../testing/how-tos/](../testing/how-tos/). Do not put those here.

## When to write one

Write an ADR when the change would otherwise disappear into a PR description:

- A new package, a retired name, or a layering change
- Class vs namespace vs loose function (or a reversal)
- Host decoupling, test strategy, or CLI shape that other packages must follow
- A rejected alternative that someone will propose again in six months

Do **not** write an ADR for a bug fix, a rename of a private symbol, or a how-to.

## Changing a decision

Update the topic's record **in the same PR as the code**. Rewrite what no longer holds, add a dated line to its **History**, and bump _updated_. Never a quiet edit: the History line is the trail. If the decision changes a standing rule, amend [architecture/](../architecture/) or [style/](../style/) in that PR too.

## A new topic

1. Copy [template.md](template.md) to `NNNN-short-kebab-title.md`. Take the next unused number (four digits); numbers are never reused.
2. Fill **Context**, **Decision**, **Consequences**, and start **History**. Status is `Proposed` on the WIP PR, then `Accepted` when it merges.
3. Add a row to the index below, under the right area.

## Merging and splitting

- When topics drift together, merge them. The earliest record still in force keeps its number; delete the others (git keeps them), point every reference at the survivor, and list the old numbers on its **Merges** line.
- An old number from a commit, an issue or a chat that has no file any more was merged into another record: `grep -l 0035 docs/adr/*.md` finds it on that record's **Merges** line.
- When a record passes about two pages, split it by topic.

## Index

### Process and platform

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions in `docs/adr/`, one record per topic | Accepted |
| [0002](0002-secrets-from-the-environment.md) | Secrets come from the environment; Bitwarden supplies them | Accepted |
| [0003](0003-no-changesets-until-public-release.md) | No changesets until the first public release | Accepted |
| [0004](0004-oxlint-and-prettier.md) | Lint with oxlint, format with Prettier | Accepted |
| [0009](0009-agent-instructions-in-agents-md.md) | Agent instructions live in `AGENTS.md`, for any agent; `CLAUDE.md` imports it | Proposed |
| [0014](0014-package-names.md) | Products keep their names (forge, flux, crucible, scribe); support libraries are named for what they do (`core`, `http`, `config`, `data`, `workspace`) | Proposed |

### Build and packaging

| ADR | Decision | Status |
|---|---|---|
| [0006](0006-forge-package-deployables.md) | `forge package` puts a deployable and the libraries it reaches in one `.package/` folder, installed with npm, no symlinks | Proposed |
| [0012](0012-workspace-package-resolution.md) | Workspace packages resolve to source from the workspace aliases (entry, exported subpaths, `src/<sub>`; `.ts`/`.tsx`/`.mts`/`.cts`); `forge paths` generates them for `tsc` | Proposed |
| [0015](0015-core-devkit-testing.md) | `core` is the runtime base (no third-party deps beyond `reflect-metadata`, no side effects on import); the CLI base is `devkit`, test helpers are `testing`, `semver` lives in forge | Proposed |
| [0017](0017-dependency-manifests-from-imports.md) | `forge dependencies sync` writes each package's dependency lists from its imports; the root owns every version; peers are declared by name in the package's `peerDependencies`; a shipped import of a root devDependency is an error unless it is a peer | Proposed |

### Data

| ADR | Decision | Status |
|---|---|---|
| [0011](0011-database-bootstrap.md) | Database bootstrap: `auth: trust` is declared (development only), never inferred; each data source's `schema` is created and granted on; a database is bootstrapped once, granting only what is missing | Proposed |

### Dependency injection

| ADR | Decision | Status |
|---|---|---|
| [0013](0013-container-keys-and-lifetimes.md) | The DI container keys services by identity; a missing dependency, a cycle or a singleton depending on a request-scoped service throws when resolved; `@optional()` marks what may be absent | Proposed |

### Logging

| ADR | Decision | Status |
|---|---|---|
| [0016](0016-scribe-on-any-runtime.md) | Scribe's facade uses only the language and `console`; writers are adapter packages (`scribe-pino` for Node, `scribe-console` anywhere); one entry shape, live `child`, a tap whose errors are rethrown; redaction is each adapter's job, not the facade's | Proposed |

### HTTP

| ADR | Decision | Status |
|---|---|---|
| [0010](0010-hosted-services.md) | Background work runs as hosted services (`withHostedService`), started before HTTP listens, stopped before the container is disposed; DataSources are closed by the container | Proposed |
| [0005](0005-server-sent-events-in-http.md) | Server-sent events from controller routes via `@Sse()`, one-way, before WebSockets | Accepted |
| [0007](0007-serving-a-built-ui-from-http.md) | A module serves its built UI with `withStatic`: outside the pipeline and the rate limit, cached by file kind, SPA fallback | Proposed |
| [0008](0008-response-compression-in-http.md) | `@decohere/http` compresses responses by default with `withCompression`, a thin wrapper around `@fastify/compress` with best-practice defaults; static pre-compression deferred | Proposed |
