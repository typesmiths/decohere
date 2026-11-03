# 0015. `core` is the runtime base; CLI tooling is `devkit`, test helpers are `testing`

- **Status:** Proposed
- **Date:** 2026-10-22 · updated 2026-10-23

## Context

`@decohere/core` was the shared toolbox for two very different groups: the runtime packages in a user's production app (crucible, http, config, data, scribe-pino), and our own command-line tools (forge, flux, `decohere`, the scaffolder). npm installs a package's whole dependency list, whichever subpaths are used. So an app that used only http and crucible still installed `commander`, `glob`, `picomatch` and `@cacheable/node-cache`. Any advisory in a library only our CLI uses would then fail a user's production audit.

Two other problems sat in `core`:

- `diagnostics` reconfigured scribe when it was imported with `FORGE_TRACE` set. That's a side effect on import, in a base library, keyed on forge's environment variable.
- `@memoize` and `@cache` pulled in a TTL cache library to do what a `Map` does. Nothing set a TTL.

## Decision

- **`@decohere/core` is the runtime base**, and nothing else:
  - `reflection`, `composition`, `configuration`, `extensibility`, `objects`, `collections` and `system`;
  - `caching`;
  - `io`'s basic file operations (`fileExists`, `readFile`, `writeFile`, `copyFile`, `removeDir`, …) and the shared file types (`File`, `FileEx`, `Directory`, `Watcher`).

  Its only third-party dependency is `reflect-metadata`, and no module has a side effect on import.
- **`@decohere/devkit` is the shared base for Decohere's command-line tools**, and nothing in it runs in a production app:
  - `cli`: the command/action framework on `commander`;
  - `interop`: the `git`, `npm`, `pnpm`, `yarn`, `docker` and `node` wrappers;
  - `diagnostics`: `trace` and `timed`;
  - `io`: file search and watch (`findFiles`, `findFile`, `findDirectories`, `watch`), on `glob` and `picomatch`.
- **`@decohere/testing` holds the Vitest helpers**: memfs file systems, the mock logger, `spyOnConstructor` and `flushPromises`.
- **`semver` lives in forge**, its only user.
- **Caching is a plain `Map`** (`MapCache`). `@cache` hands out a `structuredClone` of an object, so a caller can't change the cached value, and `@memoize` hands out the stored reference. That's how `@cacheable/node-cache` behaved with and without `useClones`.
- **Trace mode is read when a method is decorated.** `FORGE_TRACE` is read at that point, not when the module loads. Raising the log level so the timings show is the bins' job: `cliLogLevel` picks `--log-level`, then the environment's level, then `trace` when `FORGE_TRACE` is set, then scribe's default.
- **Dependencies point one way:** `devkit` and `testing` depend on `core`, and `core` never imports either.

Rejected:

- **One `tooling` package for the CLI base and the test helpers.** The name reads as a dumping ground, and the two have different consumers: tests use the helpers, and the CLIs use the rest.
- **`semver` in `devkit`.** Only forge uses it.

## Consequences

- A production app using http and crucible no longer installs `commander`, `glob`, `picomatch` or `@cacheable/node-cache` through `core`. (`http` itself uses `picomatch` to match `withStatic`'s `exclude` patterns; that's a runtime need of `http`'s own.)
- Moving a module between `core`, `devkit` and `testing` after 0.1.0 is a breaking change, so this boundary is meant to hold.
- `devkit` and `testing` are new npm names: each needs a first publish and a Trusted Publisher, as for ADR 0014.
- `@decohere/testing` declares `vitest` and `memfs` as peer dependencies ([ADR 0017](0017-dependency-manifests-from-imports.md)): the consumer's test setup provides them.
- Code that called `io.findFiles` or `io.watch` imports `findFiles` and `watch` from `@decohere/devkit/io` instead.

## History

- 2026-10-22: Decided.
- 2026-10-23: `@decohere/testing` declares `vitest` and `memfs` as peers now that the dependency sync writes peers ([ADR 0017](0017-dependency-manifests-from-imports.md)).
