# 0012. Workspace packages resolve to source from one map, generated for tsc

- **Status:** Proposed
- **Date:** 2026-10-20

## Context

In this repo and in debug builds, `@scope/pkg` and `@scope/pkg/sub` must reach the package's TypeScript source, so a library can be edited without building it. Nothing links workspace packages into `node_modules` (there is no pnpm workspace), so each tool needs its own way in:

- Flux, forge's debug builds and the Vitest plugin use `@decohere/workspace`'s aliases.
- A site Vite builds (Astro, a Vite app) uses Vite's resolver, which knows nothing of them.
- `tsc` uses tsconfig `paths`.
- The repo's bootstrap loader (`tools/register.mjs`) reads the same `paths`.

The aliases only knew `name` → `main` and `name/*` → `src/<sub>.ts`. Subpaths that were directories or other files, and packages whose `main` is the published `index.js`, worked only through a hand-kept list in the root tsconfig, which had drifted.

## Decision

- **The workspace aliases are the one map.** They give each package's source entry, each subpath its `exports` declares mapped back to its source under `src/` (omitted when the source does not exist), and `name/*` for the rest: `src/<sub>` with a source extension, else `src/<sub>/index`.
- **Source extensions are `.ts`, `.tsx`, `.mts` and `.cts`.** `./a.js` names `a.ts` or `a.tsx`, `./a.mjs` names `a.mts`, `./a.cjs` names `a.cts`; `.cts` runs and builds as CommonJS. The rules live in `sourceExtensions` in `@decohere/workspace`.
- **Vite gets the map from a plugin.** `forgeAliases()` (`@decohere/forge/vite`) resolves package names through the same aliases, for any file type a package holds (`.astro`, `.css`), not only TypeScript. The Vitest plugin resolves through it too. A site lists packages it takes from the registry instead in `fromRegistry`.
- **`tsc` gets the map as a generated file.** `forge paths` writes `tsconfig.paths.json`, which the root tsconfig extends. `forge paths --check` runs in `lint:check` and fails when it is stale. Nobody edits `paths` by hand; a key in the root tsconfig's own `paths` still overrides the map.

## Consequences

- Adding a package or subpath needs no tsconfig edit: run `pnpm forge paths` (lint says when).
- `exports` must keep sources under `src/`, mirrored in the build output (`./es6/src/...`), for the mapping back to source to work.
- Published packages still resolve through their real `exports`.
- One more generated file to commit. Prettier ignores it, so `--check` compares it byte for byte.

## History

- 2026-10-20: Decided. Replaced the hand-written tsconfig `paths`.
- 2026-11-09: Vite-built sites get the map through `forgeAliases()`, in place of pnpm workspaces, `link:` dependencies or aliases written in each site. A `name/*` subpath that names a file other than TypeScript now resolves to that file.
