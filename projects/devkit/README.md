# Devkit

**For contributors.** Devkit only builds Decohere's own command-line tools. Apps never import it.

The shared base for Decohere's command-line tools: forge, flux, the `decohere` CLI and the scaffolder ([ADR 0015](../../docs/contributing/adr/0015-core-devkit-testing.md)). Nothing here runs in a production app, so a production install never pulls in `commander`, `glob` or `picomatch` through it.

| Subpath | What it is |
|---|---|
| `@decohere/devkit/cli` | The command framework on [commander](https://github.com/tj/commander.js): `DecohereCommand`, `Action`, and the shared options (`--configuration`, `--log-level`, `--env-file`, `--dry-run`, …) |
| `@decohere/devkit/interop` | Typed wrappers that run `git`, `npm`, `pnpm`, `yarn`, `docker` and `node`, plus package-manager detection |
| `@decohere/devkit/diagnostics` | `@trace` (method timings when `FORGE_TRACE` is set), `@Trace` (the same on every method of a class) and `@timed` (always) |
| `@decohere/devkit/io` | File search and watch: `findFiles`, `findFile`, `findDirectories`, `watch`, `WatchEvents` |

Basic file operations (`fileExists`, `readFile`, `writeFile`, …) and the file types (`FileEx`, `Watcher`) stay in `@decohere/core/io`, where runtime packages can use them without these dependencies.

`@trace` reads `FORGE_TRACE` when a method is decorated, and importing it changes nothing. The bins decide the log level: `FORGE_TRACE` makes them log at `trace` unless `--log-level` or a level in the environment says otherwise.

## Working on this package

For contributors to Decohere: how the package is laid out and tested. Using it needs nothing below.

`src/` has one folder per subpath, each with an `index.ts`:

- `cli/`: `DecohereCommand`, `Action`, `ModuleManifest` and the shared options, which forge, flux, the scaffolder and `@decohere/cli` build their commands on.
- `interop/`: one folder per tool it runs (`git/`, `npm/`, `pnpm/`, `yarn/`, `docker/`, `node/`, `shell/`), with `scripts/` (package scripts), `types/` (package-manager detection) and `errors/`.
- `diagnostics/`: `trace.ts`. `io/`: `find-file.ts`, `find-directories.ts`, `watch.ts`.

There is no canonical suite for devkit in the [testing table](../../docs/contributing/testing/README.md#canonical-suite-ownership): its commands are tested through the CLI suites in `projects/cli/tests/`. Its own specs are in `tests/`, one folder per subpath (`watch.real-fs.spec.ts` uses the real disk), and move beside the code ([ADR 0027](../../docs/contributing/adr/0027-code-design.md)).
