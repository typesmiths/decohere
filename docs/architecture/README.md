# Architecture

The rules every package follows. New code follows them; if existing code disagrees, fix the code or change this page in a PR. Where files go: the [repo map](../README.md#repo-map). Why a rule exists: [decisions](../adr/).

## Packages

Publishable packages live in `projects/`. [`@decohere/workspace`](../../projects/workspace/README.md#workspace-layout) finds them through `projects/**/package.json`.

| Package | Path | Role |
|---|---|---|
| [`@decohere/core`](../../projects/core/) | `projects/core` | Runtime base: reflection, composition, extensibility, caching, file IO ([ADR 0015](../adr/0015-core-devkit-testing.md)) |
| [`@decohere/crucible`](../../projects/crucible/README.md) | `projects/crucible` | Dependency injection |
| [`@decohere/scribe`](../../projects/scribe/README.md) | `projects/scribe/scribe` | Logging facade; no dependencies, any runtime with a `console` ([ADR 0016](../adr/0016-scribe-on-any-runtime.md)) |
| `@decohere/scribe-pino` | `projects/scribe/scribe-pino` | Pino writer |
| `@decohere/scribe-console` | `projects/scribe/scribe-console` | JSON console writer (Workers, browsers, Deno, Bun, Node) |
| [`@decohere/http`](../../projects/http/README.md) | `projects/http` | HTTP: Fastify, routing, auth, OpenAPI; the test helpers at `/testing` ([ADR 0026](../adr/0026-app-recipes-and-test-helper.md)) |
| [`@decohere/config`](../../projects/config/README.md) | `projects/config` | Configuration from YAML and environment sources |
| [`@decohere/data`](../../projects/data/data/README.md) | `projects/data/data` | Repository, query and unit-of-work contracts; the change tracker for providers without one ([ADR 0024](../adr/0024-default-orm.md)) |
| [`@decohere/data-postgres`](../../projects/data/data-postgres/README.md) | `projects/data/data-postgres` | Everything Postgres-only: creating a data source's database, roles and schema at startup, passed to a provider as `bootstrap` |
| [`@decohere/data-mikro-orm`](../../projects/data/data-mikro-orm/README.md) | `projects/data/data-mikro-orm` | MikroORM provider: the `mikroOrm()` plugin, over MikroORM's own unit of work |
| [`@decohere/data-typeorm`](../../projects/data/data-typeorm/README.md) | `projects/data/data-typeorm` | TypeORM provider: the `typeOrm()` plugin, on data's change tracker |
| [`@decohere/devkit`](../../projects/devkit/README.md) | `projects/devkit` | Base for the CLIs: commands, `git`/`npm`/`docker` wrappers, file search and watch. Never in a production app |
| [`@decohere/workspace`](../../projects/workspace/README.md) | `projects/workspace` | Workspace model: package discovery and aliases |
| [`@decohere/forge`](../../projects/forge/README.md) | `projects/forge` | Build (SWC), typecheck, test, version, publish, Docker; Vitest plugin at `@decohere/forge/vitest`; `@decohere/forge/transpile` compiles a file without loading forge's commands (what flux uses) |
| [`@decohere/flux`](../../projects/flux/README.md) | `projects/flux` | Runs TypeScript from source with in-process reload |
| `@decohere/cli` | `projects/cli` | The CLI host: `decohere`, `forge` and `flux` bins |
| [`@decohere/create`](../../projects/create/README.md) | `projects/create` | `npm create @decohere`: runs the scaffolder in Docker |
| `@decohere/scaffold` | `projects/scaffold` | The scaffolder: `create`, `add` and `auth0` modules |
| [`@decohere/testing`](../../projects/testing/README.md) | `projects/testing` | Vitest helpers: memfs, mock logger, constructor spies |
| `@decohere/ci-tools` | `projects/ci-tools` | Scripts the CI workflows run |
| `@decohere/devcontainer` | `projects/devcontainer` | Base image for scaffolded apps' Dev Containers (private; image only) |

Layers, simplified:

```text
runtime  (what a production app installs):  scribe → core → crucible → config, data* · http (on config and scribe-pino)
tooling  (never in a production app):       core → devkit → workspace → forge → flux → cli
other:                                      testing · create (launcher) / scaffold · ci-tools
```

## 1. Keep the product pure of its host

Product code expresses the domain. Hosts (Vitest, CI, Docker, the IDE, npm, the shell) stay at the edges: bin entries, adapters, config.

- No `process.env.VITEST`, `NODE_ENV === "test"` or `process.env.CI` branches in library or domain code.
- No guards that only exist so an importer can load a module (such as "am I the entry?" checks so Vitest can import a bin). A bin file always starts its CLI.
- No test-only or CI-only hooks exported from product modules.
- Library modules have no side effects on import.

How we test without those: [testing](../testing/).

## 2. Vendors stay at the composition edge

Application and domain code depend on Decohere contracts; vendor code lives in an adapter chosen at the app's composition root. Fastify, Pino, MikroORM/Postgres and Auth0 are today's defaults, not requirements. Switching one should be a provider and config change, not a rewrite. Examples: Scribe's facade and its writers, `data` and its providers (`data-mikro-orm`, `data-typeorm`), `config`'s replaceable sources.

## 3. One owner per fact

A fact has one owner, and consumers ask it. Flux and Forge both call `workspace.getPackageAliases()` rather than deriving aliases themselves. A consumer that needs a new shape adds a method to the owner or adapts at its edge.

## 4. Progressive: new apps start from a recipe the app owns

A new app should run in minutes, and a grown app should use only what it needs and be able to swap any part.

- **A recipe is code the scaffolder writes into the app**, not a package the app imports. A web API on Fastify gets an `app.ts` that spells out its composition: logging, `http(FastifyProvider, …)`, `config(…)`, `health()`. Swapping the HTTP provider or the logger is editing that line. More recipes (another provider, a worker without HTTP) are more scaffolder templates, not more packages.
- **No preset hides the composition.** A plugin that wires several packages would hard-wire one vendor per part, and need one more package for each combination.
- **Each package depends only on what its own code needs.** `@decohere/http` doesn't install config or a logging library. A package that pulls in more is a bug against this rule.

## Key patterns

- **DI:** `@injectable()` with a **value** import for constructor parameter types; `@inject(Class | Token)` for interfaces, symbols, arrays or an explicit key. [Crucible](../../projects/crucible/README.md).
- **HTTP:** `@Controller()` from `@decohere/http`; handlers orchestrate, services hold the logic.
- **Dispose and reload:** Flux calls `Symbol.asyncDispose` on the entry's default export, so `export default app` is enough at the composition root. `App.dispose` stops hosted services (`withHostedService`, [ADR 0010](../adr/0010-hosted-services.md)), then disposes the container, then Scribe. Long-lived services implement `Symbol.asyncDispose`.
- **Logging:** libraries log through Scribe, never a concrete logger.
- **Configuration:** `@decohere/config` sources behind tokens.
- **Data:** `@decohere/data` repositories over a request-scoped unit of work that tracks changes and writes them on `commit()`; queries in Decohere's `Query<T>`, never an ORM's options. Migrations are Decohere's own, the same with either provider; building an app changes nothing in its database, and starting it migrates (in development), synchronizes and seeds.
- **Build and test:** Forge builds packages; tests compile through `@decohere/forge/vitest` (`forgeBuild`).
- **Scaffolded apps:** `projects/<api>/`: `app.ts` composes the app (`createApp()`), with every part written out, and `main.ts` starts it.
