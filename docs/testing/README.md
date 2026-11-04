# Testing

The rules for tests in this repo. Commands for running them: [contributing](../contributing/). Patterns: [how-tos](#how-tos).

## Behavior over internals

Test what the program does for its users (files written, HTTP responses, exit codes), not that a collaborator was called.

- Each concern has one canonical behavior suite (table below). Write it first.
- Unit tests cover only edges that suite cannot see. That is where `vi.mock` and `toHaveBeenCalled` belong.
- Never keep two suites that assert the same behavior.

## Executable behavior before type contracts

[Forge](../../projects/forge/README.md) transpiles with SWC and [Flux](../../projects/flux/README.md) runs the output without waiting for a typecheck. A green typecheck does not prove the process starts or a route responds; a test does. So:

1. Run the program and exercise the behavior.
2. Prove it with the smallest executable test: a behavior suite for user-visible results, a unit for an isolated edge.
3. Fix types and run `pnpm run typecheck` before review. Type errors are deferred from the inner loop, never accepted.

## Canonical suite ownership

| Concern | Canonical behavior suite | Units only for |
|---|---|---|
| scaffolder tree | `projects/scaffold/tests/cli.integration.spec.ts` | model and contract edges |
| create Docker host | `projects/create/e2e/scaffold-docker.e2e.spec.ts` | `runInBuilder` and argv in `projects/create/tests/runner.spec.ts` |
| product CLI shape | `projects/cli/tests/product.integration.spec.ts` | per-module forge, flux and create suites |
| forge CLI | `projects/cli/tests/forge.integration.spec.ts` | action edges the CLI cannot see |
| flux CLI | `projects/cli/tests/flux.integration.spec.ts` | HotReloadServer edges in `projects/flux/tests/hmr.server.spec.ts` |
| HTTP | `projects/http/tests/*.integration.spec.ts` | crypto, SSRF and `*.pentest.spec.ts` edges |
| scribe facade | `projects/scribe/scribe/tests/scribe.integration.spec.ts` | env helpers, console edge cases |
| scribe + pino | `projects/scribe/scribe-pino/tests/scribe-pino.integration.spec.ts` | `pinoRecipe.transport` plan shapes, transport guard |
| scribe + JSON console | `projects/scribe/scribe-console/tests/json-console.adapter.integration.spec.ts` | none |

CLI behavior suites run in-process against memfs: `RootModule.create([...])`, then `app.run(["forge", "build"])`.

## Where tests go and where they run

Projects are defined in the root `vitest.config.ts`.

| File | Place | Run by |
|---|---|---|
| `*.spec.ts` | `tests/` beside the package's `src/` | `pnpm test` (project `unit`) |
| `*.integration.spec.ts` | `tests/`; a behavior suite, same runner | `pnpm test` |
| `*.docker.spec.ts` | `tests/`; needs a Docker daemon (for example real Postgres) | `pnpm test:docker` (project `docker`), and CI |
| `*.spec.ts` under `e2e/` | `e2e/` beside `src/`; drives built CLIs or images, real disk | `pnpm run test:e2e` (project `e2e`), and CI |
| fixtures | `tests/__fixtures__/` (or `e2e/__fixtures__/`) | |

- `pnpm test` must pass on a fresh clone with no Docker, network or tokens. Use loopback servers, memfs or IP literals, not real hosts.
- `unit` and `docker` load `vitest.setup.ts`, so `fs`, `glob` and `import()` read memfs. Tests stay in memory; the real disk is for what a test can't keep in memory, such as a child process or worker thread ([when, and how](how-tos/module-load-hooks-with-memfs.md)). `e2e` uses the real disk.

## How-tos

| Article | Use it to |
|---|---|
| [Files in memory (memfs)](how-tos/module-load-hooks-with-memfs.md) | Work with the default memfs `fs`, `glob` and `import()`, or opt out |
| [Fail-fast glob mock](how-tos/vitest-glob-automock-fail-fast.md) | Stub `glob` per test in a pure unit |
| [Mocking a collaborator](how-tos/vitest-mocking-with-type-safety.md) | Mock with real types, and assert your code rather than the mock |
| [Constructor spy under DI](how-tos/vitest-constructor-spy-with-di.md) | Assert what crucible injected into a constructor |
| [Asserting Scribe logs](how-tos/spying-on-scribe-loggers.md) | Check what was logged |
| [Env-dependent decorators](how-tos/testing-environment-variables-with-decorators.md) | Test a decorator that reads the environment at import time |
