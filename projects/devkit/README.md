# Devkit

The shared base for Decohere's command-line tools: forge, flux, the `decohere` CLI and the scaffolder ([ADR 0015](../../docs/adr/0015-core-devkit-testing.md)). Nothing here runs in a production app, so a production install never pulls in `commander`, `glob` or `picomatch` through it.

| Subpath | What it is |
|---|---|
| `@decohere/devkit/cli` | The command framework on [commander](https://github.com/tj/commander.js): `DecohereCommand`, `Action`, and the shared options (`--configuration`, `--log-level`, `--env-file`, `--dry-run`, …) |
| `@decohere/devkit/interop` | Typed wrappers that run `git`, `npm`, `pnpm`, `yarn`, `docker` and `node`, plus package-manager detection |
| `@decohere/devkit/diagnostics` | `@trace` (method timings when `FORGE_TRACE` is set) and `@timed` (always) |
| `@decohere/devkit/io` | File search and watch: `findFiles`, `findFile`, `findDirectories`, `watch`, `WatchEvents` |

Basic file operations (`fileExists`, `readFile`, `writeFile`, …) and the file types (`FileEx`, `Watcher`) stay in `@decohere/core/io`, where runtime packages can use them without these dependencies.

`@trace` reads `FORGE_TRACE` when a method is decorated, and importing it changes nothing. The bins decide the log level: `FORGE_TRACE` makes them log at `trace` unless `--log-level` or a level in the environment says otherwise.
