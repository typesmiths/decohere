# 0015. `core` is the runtime base; CLI tooling is `devkit`, test helpers are `testing`

- **Status:** Proposed
- **Date:** 2026-10-22 · updated 2026-11-04

## Context

`@decohere/core` served two groups: the runtime packages in a user's production app (crucible, http, config, data, scribe-pino) and our own CLIs (forge, flux, `decohere`, the scaffolder). npm installs a package's whole dependency list, whatever subpaths are used, so an app using only http and crucible installed `commander`, `glob`, `picomatch` and a TTL cache library. An advisory in something only our CLI uses would fail a user's production audit.

Two more problems sat in `core`: `diagnostics` reconfigured scribe on import when `FORGE_TRACE` was set (a side effect on import, keyed on forge's variable), and `@memoize` / `@cache` pulled in a TTL cache to do what a `Map` does, with no TTL ever set.

## Decision

- **`@decohere/core` is the runtime base**, and nothing else:
  - `reflection`, `composition`, `configuration`, `extensibility`, `objects`, `collections`, `system`, `caching`;
  - `io`'s basic file operations (`fileExists`, `readFile`, `writeFile`, `copyFile`, `removeDir`, …) and the shared file types (`File`, `FileEx`, `Directory`, `Watcher`);
  - hosting (`Builder`, `App`, hosted services), when it moves from `http` ([ADR 0014](0014-package-names.md)).

  Its only third-party dependency is `reflect-metadata`, and no module has a side effect on import.
- **`@decohere/devkit` is the base for Decohere's CLIs**, and nothing in it runs in a production app:
  - `cli`: the command/action framework on `commander`;
  - `interop`: wrappers for `git`, `npm`, `pnpm`, `yarn`, `docker` and `node`;
  - `diagnostics`: `trace` and `timed`;
  - `io`: file search and watch (`findFiles`, `findFile`, `findDirectories`, `watch`), on `glob` and `picomatch`.
- **`@decohere/testing` holds the Vitest helpers**: memfs file systems, the mock logger, `spyOnConstructor`, `flushPromises`. It declares `vitest` and `memfs` as peers ([ADR 0017](0017-dependency-manifests-from-imports.md)).
- **The `semver` module lives in forge** (`src/semver`), its only user.
- **Caching is a plain `Map`** (`MapCache`). `@cache` returns a `structuredClone`, so callers cannot change the cached value; `@memoize` returns the stored reference.
- **Trace mode is read when a method is decorated**, not when the module loads. Raising the log level so timings show is the bins' job: `cliLogLevel` takes `--log-level`, then the environment's level, then `trace` when `FORGE_TRACE` is set, then scribe's default.
- **Dependencies point one way:** `devkit` and `testing` depend on `core`; `core` imports neither.

Rejected:

- **One `tooling` package for the CLI base and test helpers.** The name reads as a dumping ground, and the two have different consumers.
- **`semver` in `devkit`.** Only forge uses it.

## Consequences

- A production app using http and crucible installs none of `commander`, `glob` or a cache library through `core`. (`http` uses `picomatch` itself, for `withStatic`'s `exclude`.)
- Moving a module between `core`, `devkit` and `testing` after 0.1.0 is a breaking change, so the boundary is meant to hold.
- File search and watch are imported from `@decohere/devkit/io`.

## History

- 2026-10-22: Decided.
- 2026-10-23: `@decohere/testing` declares `vitest` and `memfs` as peers now that the dependency sync writes peers ([ADR 0017](0017-dependency-manifests-from-imports.md)).
- 2026-11-04: Hosting is planned to move into `core` from `http` ([ADR 0014](0014-package-names.md)).
