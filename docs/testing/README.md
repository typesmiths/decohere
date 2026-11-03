# Testing

Normative principles first. How-tos under [how-tos/](how-tos/). How to run a file and validate a fix: [../contributing/](../contributing/).

## Behavior over internals

Prove **what the program does for users**, not that a collaborator was called.

- Primary use cases first (files, HTTP, exit codes).
- Unit tests are for **edges the behavior suite cannot see**. They come after, never instead of, the behavior suite.
- `toHaveBeenCalled` / `vi.mock` belong on those edges.
- Do not maintain two suites that assert the same behavior.

## Executable behavior before type contracts

Decohere does not make a whole-workspace typecheck the price of building or booting. [Forge](../../projects/forge/README.md) transpiles with SWC and [Flux](../../projects/flux/README.md) runs that output path immediately; typechecking is a separate workflow that can run in the background.

Executable tests are the primary evidence that a program functions as intended. Fast unit tests provide inner-loop feedback; behavior and integration suites own user-visible outcomes. A green typecheck proves that declarations satisfy a static contract—it does not prove that the process starts, a route responds, or a use case works.

Work in this order:

1. Build or boot the program and exercise the behavior.
2. Prove the outcome with the smallest useful executable test: behavior/integration for user-visible results, focused units for isolated edges.
3. Polish the type contract and run typecheck before review and release.

Type errors are not ignored or accepted release output. They are deferred from the inner run/test loop so they do not block executable feedback. Better surfacing of background type diagnostics is planned.

### Canonical suite ownership

| Concern | Canonical behavior suite | Units only for |
|---|---|---|
| scaffolder tree | `projects/scaffold/tests/cli.integration.spec.ts` | model/contract edges |
| create Docker host | `projects/create/e2e/scaffold-docker.e2e.spec.ts` | `runInBuilder` / argv in `projects/create/tests/runner.spec.ts` |
| product CLI shape | `projects/cli/tests/product.integration.spec.ts` | per-module forge/flux/create suites |
| forge CLI | `projects/cli/tests/forge.integration.spec.ts` | action edges CLI cannot see |
| flux CLI | `projects/cli/tests/flux.integration.spec.ts` | HotReloadServer edges (`projects/flux/tests/hmr.server.spec.ts`) |
| HTTP | `projects/http/tests/*.integration.spec.ts` | crypto/SSRF/pentest edges |
| scribe facade | `projects/scribe/scribe/tests/scribe.integration.spec.ts` | env argv helpers, console edge cases |
| scribe + pino | `projects/scribe/scribe-pino/tests/scribe-pino.integration.spec.ts` | `pinoRecipe.transport` plan shapes, transport guard |
| scribe + JSON console | `projects/scribe/scribe-console/tests/json-console.adapter.integration.spec.ts` | none |

CLI behavior tests launch as Node does: `argv` shaped like `node node_modules/.bin/<name> …`, in-process, **memfs**.

## Where tests run

- `pnpm test` must pass on a fresh clone with no Docker, no network, and no tokens. Use loopback servers, memfs, or IP literals rather than real hosts.
- A suite that needs a Docker daemon (for example a real Postgres) is named `*.docker.spec.ts`. `pnpm test` skips it; `pnpm test:docker` runs it, and so does CI.

## How-tos

| Article | Description |
|---|---|
| [Vitest mocking with type safety](how-tos/vitest-mocking-with-type-safety.md) | Minimal dependency mocks |
| [Vitest constructor spy with Crucible DI](how-tos/vitest-constructor-spy-with-di.md) | Spy on constructors without breaking DI |
| [Vitest glob automock fail-fast](how-tos/vitest-glob-automock-fail-fast.md) | Safe-by-default glob mocking |
| [Spying on Scribe loggers](how-tos/spying-on-scribe-loggers.md) | Assert logger calls without fighting pino |
| [Testing chokidar with memfs](how-tos/testing-chokidar-with-memfs.md) | Watch events against memfs |
| [Module load hooks with memfs](how-tos/module-load-hooks-with-memfs.md) | Dynamic imports against memfs |
| [Testing environment variables with decorators](how-tos/testing-environment-variables-with-decorators.md) | Decorator tests with cache busting |
| [Unit test design principles](how-tos/unit-test-design-principles.md) | Test the code, not the mock |
