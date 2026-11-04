# @decohere/flux

In-process TypeScript load for Node.js ESM apps — either one-shot (`flux run`) or hot-reload serve (`flux serve`).

Use Flux when you want to run source `.ts` directly. Flux transpiles with the **Forge** SWC compiler and maps imports to source with path aliases the workspace package builds dynamically from the workspace (`package.json` `name` → source `main`). Do not use Flux as a browser bundler, a worker-thread HMR, or a production process manager.

Point Flux at a tree of TypeScript packages (`package.json` at each project root). [`@decohere/workspace`](../workspace/README.md) is how that tree is deduced — you do not run Flux against the workspace package. Layout and glob overrides: [the workspace package — workspace layout](../workspace/README.md#workspace-layout).

This package is the Flux API. You use it through the `flux` CLI (`flux run` / `flux serve`), not by importing `@decohere/flux` from application code. The [Programmatic API](#programmatic-api) is only for embedding Flux in another tool.

Related: [`@decohere/workspace`](../workspace/README.md) (package discovery), [Forge](../forge/README.md) (SWC + debug aliases). The `flux` command ships in `@decohere/cli`.

## When to use

| Use Flux | Use something else |
|---|---|
| Local debug of Node apps with HMR (`serve`) | Production (`node` on Forge release output, Docker, orchestrator) |
| One-shot TS CLI / script without a pre-build (`run`) | Published package `bin` entries (stay built JS) |
| Packages resolved by `package.json` name | Browser UI (Vite / `ng serve` / … via package scripts) |
| Clean `Symbol.asyncDispose` on reboot (`serve`) | Worker threads / `createRequire` |

## `run` vs `serve`

| | `flux run <entry.ts>` | `flux serve` |
|---|---|---|
| Compiles `.ts` on load | ✅ | ✅ |
| File watch / HMR reboot | ❌ | ✅ |
| Entry | Any path you pass | Package `main` (`main.ts` / `main.tsx`) |
| Process | Exits when the entry finishes | Long-lived until Ctrl+C (SIGINT) or SIGTERM |

## Install

The `flux` command is on `@decohere/cli` (this package is the API). Add the CLI with your package manager:

```bash
pnpm add -D @decohere/cli
# npm install --save-dev @decohere/cli
```

That installs the `flux`, `forge`, and `decohere` bins. Then:

```bash
pnpm exec flux --help
flux run projects/greeter/src/cli.ts
flux serve
```

Scaffolded apps already depend on `@decohere/cli` — use those scripts (`pnpm dev`) or `pnpm exec flux`.

## CLI

Host options (`--root-dir`, `--config-file`, `--log-level`) are parsed before the subcommand. `--root-dir` (default: the current folder) is the workspace root. `--config-file` (default `.decohere.js` in the root, if present) is optional workspace config for package discovery. Omit it to use [workspace defaults](../workspace/README.md#workspace-layout).

### `flux run` — one-shot script

Any TypeScript file. The process exits when that module finishes evaluating.

```ts
// projects/greeter/src/cli.ts
const name = process.argv[2] ?? "world";
console.log(`hello ${name}`);
```

```bash
flux run projects/greeter/src/cli.ts
# hello world

flux run projects/greeter/src/cli.ts -- Alice
# hello Alice
```

| Flag / arg | Default | Meaning |
|---|---|---|
| `<entry>` | (required) | Path to a TypeScript entry file |
| `[args…]` | — | Forwarded to the entry after argv rewrite (`process.argv.slice(2)`) |
| `--configuration <name>` | `debug` | Build configuration name |

Before import, `run` sets `process.argv` to `[node, absoluteEntry, …args]` so the file behaves like a real Node bin. Use `--` when the entry’s own flags would otherwise be parsed by Flux (`flux run ./src/cli.ts -- --verbose`).

### `flux serve` — long-lived process (HMR)

Use `serve` when the program should stay up until you kill it (HTTP server, worker). Flux watches source, disposes the previous entry, and re-imports on change.

`serve` boots the file named in that package’s `package.json` `main`. It must be `main.ts` / `main.tsx` (see [Classification](#classification-convention)). Snippet from `projects/my-api/package.json`:

```json
{
  "name": "my-api",
  "main": "main.ts"
}
```

```ts
// projects/my-api/main.ts
import { createServer } from "node:http";

const server = createServer((_req, res) => {
	res.end("ok\n");
}).listen(3000);

console.log("listening on 3000");

export default {
	async [Symbol.asyncDispose]() {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err != null ? reject(err) : resolve()));
		});
	},
};
```

These are three ways to start the same serve (flags combine; `flux serve --project my-api --reboot-debounce-ms 500` is valid):

```bash
flux serve
flux serve --project my-api
flux serve --reboot-debounce-ms 500
```

| | What it does |
|---|---|
| `flux serve` | Boots the first discovered project (the workspace package lists packages by `package.json` `name`, A→Z). |
| `--project my-api` | Boots that package by name. |
| `--reboot-debounce-ms 500` | Same serve, but waits 500ms after the last save before rebooting (default 250ms). |

Use `--project` or [directory slices](#directory-slice-flux-serve-token) when the first package is not the app you want.

Ctrl+C (SIGINT) or SIGTERM (Docker, CI, process managers) disposes the entry, then the CLI exits with code 0.

| Flag / arg | Default | Meaning |
|---|---|---|
| `[slices…]` | — | One or more module tokens among discovered packages (union; see **Directory slice**) |
| `--configuration <name>` | `debug` | Build configuration name (not a file path) |
| `--project <name>` | first discovered package | Single package name to serve (not with slices) |
| `--reboot-debounce-ms <ms>` | `250` | Quiet window after the last affecting save before a reboot. See [Reboot debounce](#reboot-debounce) before raising it. |

On a watched change that reaches a served entry, Flux invalidates that subgraph, calls `asyncDispose` on the previous default export, and re-imports. Rapid saves are trailing-debounced and serialized (overlapping dispose cannot run). A change that never reaches an entry does nothing. Each reboot logs `flux reboot` / `flux ready` at info (project names, triggering files, elapsed ms) so the event stays visible when the app boot is chatty. File-watch detail stays at trace.

### Reboot debounce

Saves less than the window apart (250ms by default) become one reboot. Saves further apart each reboot, and a save during a reboot folds into one follow-up reboot. Whatever the timing, the app ends up on the last save; a reboot in between may fail (an import not yet updated) and logs the error.

The window adds its length to every reload, including a single save. Measured on a rename across six files:

| Gap between saves | Reboots at 250ms | Reboots at 2000ms |
|---|---|---|
| 0–100ms: parallel edits by an agent, a formatter, a checkout | 1 | 1 |
| 400ms–1.5s | 6 | 1 |
| 4s: an agent's edits made one tool call at a time | 6 | 6 |
| Time from the last save to the app ready | ~0.3s | ~2s |

So keep the default. An agent's saves in one go land inside it, and its one-at-a-time saves are seconds apart, beyond any window short enough for a person's save. Raise it only for a tool you know saves at a steady pace inside your chosen window.

### Dispose on reboot

`serve` loads the entry’s **default export**. If that object implements `Symbol.asyncDispose`, Flux calls it:

- before each HMR reboot (so the next boot can bind the same port / reopen the DB)
- on SIGINT / SIGTERM / CLI teardown

The `export default { async [Symbol.asyncDispose]() { … } }` in the server example above is that contract. Close servers, pools, and timers there — not in a `process.on("SIGINT")` handler Flux does not own.

**HTTP APIs** scaffold `export default app`. `App.dispose` disposes the root DI container, then Scribe. Constructed services that implement `Symbol.asyncDispose` (or `Symbol.dispose`) are torn down automatically — including the HTTP provider. Background work (timers, feeds, pollers) belongs in a [hosted service](../http/README.md#hosted-services): its signal is aborted and it is stopped on every reboot, so nothing keeps running into the next one. Put teardown on the service; do not wrap the default export, and do not keep workers in globals across reboots.

Flux clears its reference to the object *before* calling dispose, so a failed boot cannot dispose the same instance twice.

## Directory slice (`flux serve <token>…`)

A slice is a path token. Flux keeps workspace packages whose directory sits under that token, then [classifies](#classification-convention) each one. `flux serve shop` and `flux serve projects/shop` are the same token.

Example workspace (every leaf directory here has its own `package.json`):

```
projects/
  app.web/                   # scripts.dev: vite          → UI
  shop/
    api/                     # main: main.ts              → Node app
    worker/                  # main: main.ts              → Node app
    web/                     # scripts.dev: vite          → UI
    domain/                  # main: src/index.ts         → library
  shop-admin.api/            # main: main.ts              → other module
  billing/
    api/                     # main: main.ts              → Node app
    domain/                  # main: src/index.ts         → library
```

`flux serve shop` matches `projects/shop` and children (and `projects/shop.*`). It does **not** match `shop-admin.api`.

| | In-process (HMR) | Spawn `scripts.dev` / `serve` | Skip |
|---|---|---|---|
| `flux serve shop` | `shop/api`, `shop/worker` | `shop/web` | `shop/domain` |
| `flux serve app` | — | `app.web` | — |
| `flux serve shop-admin` | `shop-admin.api` | — | — |
| `flux serve app shop billing` | `shop/api`, `shop/worker`, `billing/api` | `app.web`, `shop/web` | `shop/domain`, `billing/domain` |

Multiple tokens are a union. Use slices **or** `--project`, not both.

Matching is path-safe:

- Nested: `shop` → `projects/shop`, `projects/shop/api`
- Flat dotted packages: `shop` → `projects/shop.web`, `projects/shop.domain`; `app` → `projects/app.web`
- Does **not** match siblings that only share a string prefix (`shop` ≠ `projects/shop-admin.api` — pass `shop-admin` explicitly)

Named serve profiles in `.decohere.js` (e.g. `shop-stack: ["app", "shop", "billing"]`) are deferred.

### Classification (convention)

| Kind | How Flux decides | Behavior |
|---|---|---|
| **Foreign / UI** | `scripts.dev` or `scripts.serve` that does **not** invoke `flux` | Spawn `pnpm`/`npm`/`yarn` `run <script>` in that package cwd. Flux does not HMR-boot it. |
| **Flux app** | `package.json` `main` ends in `main.ts` / `main.tsx`, and no foreign serve script | Boot in-process (one HMR graph per app). |
| **Library** | Everything else (e.g. `main`: `src/index.ts`) | Skip — imported via debug aliases. |

Foreign scripts win over `main.ts` so Vite (and similar) apps are never loaded in the Node HMR hook. The **package script** is the contract, not a hard-coded Vite check.

Logs name skipped libraries and deferred packages (script + cwd). Child processes are stopped when the CLI exits (SIGINT or SIGTERM → dispose).

## Compile cache

Flux keeps the code it compiles on disk, so starting again compiles only what changed. On a cold start with nothing changed, it reads every file from the cache instead of compiling it (`pnpm bench flux-load`, `flux.load.cold-cached`).

- **Where:** `<workspace>/node_modules/.cache/decohere/flux`. When the workspace has no `node_modules`, it's under `$XDG_CACHE_HOME/decohere`, then the OS temp directory.
- **Settings:** `DECOHERE_CACHE_DIR=<dir>` moves the cache; `DECOHERE_CACHE=0` turns it off.
- **When it's used:** entries are keyed by the file's path and source, the SWC options it compiles with and SWC's version. Any change to those is a miss, never stale code.
- **Concurrency:** entries are written to a temp file and renamed into place, so processes starting at once share one cache safely.
- **Housekeeping:** entries untouched for 30 days are pruned, at most once a day. To clear the cache, delete the folder. `forge clean` leaves it alone, because cleaning runs before every build.
- **If it can't be used:** when flux can't read or write the folder, it warns once and runs without the cache.

## Limits

Flux does not support `createRequire`, worker threads, or browser HMR. Reloads always dispose and re-import the entry — there is no `import.meta.hot.accept()` boundary yet.

**Restart `flux serve` after changing any of these** — they're read once at start, and saving them doesn't reboot:

- `tsconfig.json`, `.swcrc`, or `.decohere.js`
- a `package.json` (name, `main`, dependencies)
- adding or removing a package under `projects/`

Only source files (`.ts`) that a served entry imports trigger a reboot.

**Memory grows over a long session.** Each reboot imports changed modules under a new `?version=` URL, and Node's ES module cache never releases the old versions. That's fine for a working day; if a session runs for days with thousands of reboots, restart it.

Flux uses **Forge’s compiler** (`@decohere/forge/transpile`), with one SWC config per project built once per run. It never loads the TypeScript compiler: SWC strips types without checking them, so type errors are `forge typecheck`'s job. SWC leaves imports as written; Flux's resolve hook maps each one to its TypeScript source: `@scope/pkg` and `@scope/pkg/sub` through the the workspace package aliases (and tsconfig `paths`), `./file.js` and `./file` to `file.ts` or `file.tsx`, `./file.mjs` to `file.mts`, `./file.cjs` to `file.cts` (which runs as CommonJS), and `./dir` to `dir/index.ts`. Doing it in one place, instead of in SWC (`jsc.paths`, `resolveFully`) and again in the hook, made loading about 20% faster once Node and SWC are warm (`pnpm bench flux-load`). Before Node imports an entry, Flux compiles it and the files it imports, following their imports out from the entry, in parallel on SWC's thread pool. The load hook is synchronous and would otherwise compile one file at a time; files the app never imports, such as tests, are not compiled. A file that fails to compile there is compiled again when Node loads it, and that load fails with the file's name, as before. That is a debug rule so you can edit a library and hit HMR without a pre-build or `node_modules` workspace symlink. Release still resolves through real `node_modules` (published `exports` / `main`).

Why aliases, and a tree of where a symlink misses `src/index.ts`: [Forge — debug path aliases](../forge/README.md#debug-path-aliases-not-node_modules-links).

## Programmatic API

Use this only when you need to **embed** Flux (tests, a custom host). Day-to-day, invoke `flux run` / `flux serve` — do not import `@decohere/flux` from application code.

```ts
import { flux } from "@decohere/flux";

// One-shot compile-on-load (no watch) — same idea as `flux run`
await flux.run("/abs/path/to/entry.ts");
await flux.run("./tool.ts", { configuration: "debug", args: ["--flag"] });

// Long-lived HMR — same idea as `flux serve` (in-process apps)
const server = await flux.serve({
  configuration: "debug",
  project: "my-api", // optional single package
  // projects: ["api", "svc"], // optional multi-entry
  rebootDebounceMs: 500, // optional; default 250
});
server.on("reboot", () => {}); // after dispose + boot attempt for affected entries
await server.dispose();
```

`configuration` is the workspace configuration **name** (`debug`, `release`, …), matching `--configuration`. Defaults to `debug`. Pass `workspace` in tests to skip `WorkspaceFactory`.

`flux.run` keeps Node ESM hooks registered for the process so the imported graph can still load `.ts`. Do not dispose the loader after a successful run.

Slice helpers (`classifySliceProjects`, `normalizeSlicePrefix`, …) and the engine types (`SourceModuleLoader`, `HotReloadServer`) stay exported for tests and tooling; the CLI and `flux` facade are the primary surfaces.
