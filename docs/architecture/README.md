# Architecture

**Decohere** is a TypeScript monorepo. Publishable packages live under `projects/` (there is no top-level `packages/`). [`@decohere/workspace`](../../projects/workspace/README.md#workspace-layout) discovers packages via `projects/**/package.json` (overridable).

This is the **architecture document**. It is finalized for production. New code follows it. If existing code disagrees, **fix the code** — or amend this file in a docs PR.

Code shape: [../style/](../style/). Tests: [../testing/](../testing/). How we ship: [../contributing/](../contributing/). Why we chose a rule: [../adr/](../adr/). Agents: [AGENTS.md](../../AGENTS.md).

The repo was sometimes called “Ark”. Use **Decohere** in new prose.

## Core packages

| Package | Path | Role |
|---|---|---|
| `@decohere/core` | `projects/core` | Runtime base: reflection, composition, extensibility, caching, basic file IO ([ADR 0015](../adr/0015-core-devkit-testing.md)) |
| `@decohere/devkit` | `projects/devkit` | Shared base for the CLIs: command framework, `git`/`npm`/`docker` wrappers, tracing, file search and watch. Never in a production app |
| `@decohere/testing` | `projects/testing` | Vitest helpers: memfs, mock logger, `spyOnConstructor` |
| `@decohere/scribe` | `projects/scribe/scribe` | Logger facade (zero deps, any runtime with a `console` — [ADR 0016](../adr/0016-scribe-on-any-runtime.md)) |
| `@decohere/scribe-pino` | `projects/scribe/scribe-pino` | Pino adapter + recipes |
| `@decohere/scribe-console` | `projects/scribe/scribe-console` | JSON console adapter (Workers, browsers, Deno, Bun, Node) |
| `@decohere/crucible` | `projects/crucible` | Dependency injection |
| `@decohere/workspace` | `projects/workspace` | Workspace / project model. Package discovery and aliases — [layout](../../projects/workspace/README.md#workspace-layout). |
| `@decohere/forge` | `projects/forge` | Build system (SWC); Vitest plugin at `@decohere/forge/vitest`; `@decohere/forge/transpile` compiles one file without loading forge's commands (what flux uses) |
| `@decohere/flux` | `projects/flux` | In-process HMR for Node ESM |
| `@decohere/cli` | `projects/cli` | Product CLI host (bins: `decohere`, `forge`, `flux`) |
| `@decohere/http` | `projects/http` | HTTP/API platform (Fastify, routing, auth) |
| `@decohere/config` | `projects/config` | Configuration (YAML/env sources; HTTP builder extension) |
| `@decohere/data` | `projects/data/data` | Data / repository abstractions |
| `@decohere/data-typeorm` | `projects/data/data-typeorm` | TypeORM adapter |
| `@decohere/create` | `projects/create` | `npm create @decohere` Docker shim (prepends `create` when forwarding) |
| `@decohere/scaffold` | `projects/scaffold` | Generator library + `create`/`add`/`auth0` modules (published; also in the create image with Auth0 CLI) |
| `@decohere/ci-tools` | `projects/ci-tools` | CI / release / GitHub helper scripts |

Usage, flags, and APIs live in each package’s `README.md` under `projects/`.

### Layering (simplified)

```
scribe → core → crucible → http (+ config, data*)           runtime: what a production app installs
core → devkit → workspace → forge → flux → cli              tooling: never in a production app
testing (Vitest helpers)   create (launcher) / scaffold (library + image)   ci-tools
```

## 1. Host decoupling — keep the product pure

Product code expresses the domain. Hosts — Vitest, CI, Docker, IDE, npm, the shell — stay at the **edges** (bin entry, adapters, config).

**Forbidden** (unless the *domain* actually has that mode):

- `if (process.env.VITEST)` / `NODE_ENV === "test"` / `if (process.env.CI)` in library or domain code
- Guards whose only job is to neutralize an importer (e.g. `isCliEntry()` so Vitest can import a bin file)
- Test-only or CI-only hooks exported from product modules “so the harness can call in”
- Docker-only / IDE-only branches that are not a real product feature

Bin entry always runs. Library modules have no side effects on import. Testing is just one host. How we test: [../testing/](../testing/).

### Provider boundaries — manage vendor lock-in

Application and domain code depend on Decohere contracts; vendor integrations stay at the composition edge. The current scaffold selects Fastify for HTTP, Pino for logging, TypeORM/Postgres for data, and Auth0 for identity. Those are the supported defaults today, not permanent requirements of the framework.

The provider model is intended to expand across HTTP servers, logging writers, identity/auth systems, data adapters, configuration sources, and other cross-cutting concerns. Provider selection and vendor-specific configuration belong at the application composition root.

This does not pretend vendor lock-in disappears. It **contains** it: provider-specific capabilities remain in an adapter or explicit edge, while services and domain code use stable framework contracts. Changing vendors should be a provider and configuration change, not an application rewrite.

Existing examples of this direction:

- [Scribe](../../projects/scribe/README.md) separates its logging facade from Pino and other writers.
- [`@decohere/data`](../../projects/data/) separates repository/data contracts from its TypeORM adapter.
- [`@decohere/config`](../../projects/config/) composes configuration from replaceable sources.
- [`@decohere/http`](../../projects/http/) keeps the HTTP host at the framework edge; additional HTTP providers are planned.

## 2. CLIs

Bin files always start the CLI (no “am I the entry?” probes for a host).

## 3. Single responsibility and DRY

A fact about the domain has **one owner**. Consumers ask that owner.

- `workspace.getPackageAliases()` — Flux and Forge do not each derive the alias map.
- If a consumer needs a new shape, add a method on the owner or adapt at the edge.

## 4. Project layout (guidance, not a prison)

```
projects/<name>/          # or projects/<group>/<name>/ (scribe, data)
  package.json
  README.md
  src/
    index.ts              # public barrel
    const.ts              # DI tokens (optional)
    <area>/               # one folder per concern
  tests/                  # *.spec.ts — not mixed into src/
```

**`src/` root is the composition surface.** Allowed: `index.ts`, `const.ts`, and for CLI hosts `cli.ts` / `*.module.ts`.

**Not at `src/` root:** commands, actions, models, features, one-off helpers — use `commands/`, `actions/`, `models/`, `<feature>/`.

Follow **http**, **crucible**, **workspace**, and **forge**.

**Drift — do not copy for new files:**

- `projects/scaffold/src/` — commands/actions/`program.ts` loose beside `webapi/`. Target: root = `cli.ts` / `*.module.ts` / `index.ts`; rest under `commands/`, `actions/`, or `webapi/`.
- `projects/flux/src/` — run/serve command+action+loader at root. Target: `commands/`, `actions/`, engine folders.

A later cleanup PR may move those files. **This section is the rule for every new file.**

Scaffolded apps (`npm create @decohere webapi`) use `projects/<api>/` with `main.ts` as that project’s composition root.

## Key patterns

- **DI**: `@decohere/crucible` — `@injectable()` plus a **value** import for class constructor params. `@inject(Class \| Token)` for interfaces, symbols, arrays, or an explicit key.
- **HTTP**: `@Controller()` from `@decohere/http`; handlers orchestrate, logic in services.
- **Dispose / HMR**: Flux calls `Symbol.asyncDispose` on the entry default export. `App.dispose` (`@decohere/http`) disposes the DI container, then Scribe. Long-lived services implement `Symbol.asyncDispose` (or `Symbol.dispose`); background work is a hosted service (`withHostedService`, [ADR 0010](../adr/0010-hosted-services.md)), stopped before the container is disposed; `export default app` is enough at the composition root.
- **Logging**: Scribe in libraries — not concrete logger APIs.
- **Configuration**: `@decohere/config` data sources via tokens/interfaces.
- **Data**: `@decohere/data` repositories / request-scoped UoW; TypeORM `DataSource` as a singleton (`@injectDataSource`).
- **Build / test**: Forge builds packages; unit tests use `@decohere/forge/vitest` (`forgeBuild`).

## Tooling at repo root

Install and everyday commands: [contributing](../contributing/#everyday-commands).

| Tool | Role |
|---|---|
| `pnpm` | Install / scripts |
| Vitest | One `vitest.config.ts` with three projects: unit, docker and e2e |
| oxlint, Prettier | Lint, format ([ADR 0004](../adr/0004-oxlint-and-prettier.md)) |
| actionlint | Workflow lint (CI `lint` job) |
| Changesets | Stable release versioning |
