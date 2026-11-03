# 0012. Workspace packages resolve to source from one map, generated for tsc

- **Status:** Proposed
- **Date:** 2026-10-20 · updated 2026-10-21

## Context

In this repo and in debug builds, `@scope/pkg` and `@scope/pkg/sub` imports have to reach the package's TypeScript source, so a library can be edited without building it first. Nothing links workspace packages into `node_modules` (there is no pnpm workspace), so every tool needs its own way in:

- **Flux, forge's debug builds and the Vitest plugin** use the workspace package aliases.
- **`tsc`** uses tsconfig `paths`.
- **The repo's bootstrap loader (`tools/register.mjs`)** reads the same `paths`.

The workspace aliases only knew `name` → `main` and `name/*` → `src/<sub>.ts`. A subpath that is a directory (`src/io/index.ts`) or another file (`./auth` → `src/auth/auth.extensions.ts`) worked only because the root tsconfig listed 34 subpaths by hand. Five packages whose `main` is `index.js` (the published layout) resolved only through that list too, and one entry pointed at a file that no longer existed.

## Decision

- **The workspace aliases are the one map.** They give each package's source entry, each subpath its `exports` declares mapped back to its source under `src/` (left out when that source doesn't exist), and `name/*` for the rest: `src/<sub>` with a source extension, else `src/<sub>/index`.
- **Source extensions are `.ts`, `.tsx`, `.mts` and `.cts`.** `./a.js` names `a.ts` or `a.tsx`, `./a.mjs` names `a.mts`, and `./a.cjs` names `a.cts`. `.cts` runs and builds as CommonJS. The rules live in the workspace's `sourceExtensions`.
- **`tsc` gets the map as a generated file.** `forge paths` writes it to `tsconfig.paths.json`, and the root tsconfig extends that file. `forge paths --check` runs in `lint:check` and fails when the file is out of date. Nobody edits `paths` by hand. A key in the root tsconfig's own `paths` still overrides the map.

## Consequences

- **Adding a package or subpath needs no tsconfig edit:** run `pnpm forge paths` (lint says when).
- **`exports` must keep sources under `src/`,** mirrored in the build output (`./es6/src/...`), for the mapping back to source to work.
- **The repo still doesn't use `node_modules` links.** Release resolution is unchanged: published packages resolve through their real `exports`.
- **One more generated file to commit.** Prettier ignores it, so `--check` compares it byte for byte.

## History

- 2026-10-20: Decided. Replaced the hand-written tsconfig `paths`.
- 2026-10-21: Package names updated to the plain names of [ADR 0014](0014-package-names.md). The decision is unchanged.
