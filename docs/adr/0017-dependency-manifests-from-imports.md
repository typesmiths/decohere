# 0017. Package manifests are generated from imports; the root owns every version; peers are declared by name

- **Status:** Proposed
- **Date:** 2026-10-23

## Context

Decohere is not a pnpm (or npm) workspace. There is one install, from the root `package.json`, and workspace packages resolve to each other's source through the workspace aliases ([ADR 0012](0012-workspace-package-resolution.md)). Each package under `projects/` still needs its own `dependencies` for npm, and hand-kept lists drift from what the code imports.

Peers were the gap. A dependency counted as runtime or dev for every package at once, depending on which list of the root it sat in. So `@decohere/testing`, whose shipped code imports `vitest` and `memfs`, published them only as devDependencies: a consumer would not be told to install them. The hand-written peers of `scribe-pino` were not checked, and had drifted from the root's versions.

## Decision

- **`forge dependencies sync` writes each package's `dependencies` and `devDependencies` from its imports.** A package imported by the scanned files lands in `dependencies` if the root lists it in `dependencies`, and in `devDependencies` if the root lists it there. A workspace package lands with its own version. An import nothing declares is an error.
- **The root `package.json` owns every version.** Packages never pick their own ranges.
- **A package declares its peers by name, in its own `peerDependencies`**, which is where npm reads them. Sync gives each one the root's range, takes it out of `dependencies` and `devDependencies`, and keeps it even when no code imports it (a pino transport is loaded by name). A peer the root doesn't list is an error. `peerDependenciesMeta` (for example `optional`) is written by hand and kept as is.
- **Under a configuration that publishes (`pack: true`, the release configuration), shipped code may not import a root devDependency** unless the package declares it a peer. The release configuration leaves out tests, benchmarks and e2e, so what it scans is what ships. The error names each package and the files that import it.
- **`forge dependencies report --fail-on-drift` compares all three lists** (`dependencies`, `devDependencies`, `peerDependencies`) with what sync would write; CI runs it.

Rejected:

- **pnpm workspaces.** Each package would keep its own hand-written list and version ranges, and the installer layout becomes a second dependency graph next to the workspace aliases ([ADR 0006](0006-forge-package-deployables.md), [ADR 0012](0012-workspace-package-resolution.md)).
- **Declaring peers in `.decohere.js`.** That's one more place to look. The package's own `peerDependencies` is where npm and readers already look, and sync only owns the versions.

## Consequences

- Adding a third-party import means adding the package to the root (`pnpm add`), then running sync. Nothing else is hand-edited in a package's dependency lists.
- A shipped import of a development-only package fails sync and the drift check, before publishing, instead of failing a consumer at run time.
- Sync rewrites manifests with their keys in a fixed order. The drift check ignores key order, so a sync that only reorders keys isn't drift.

## History

- 2026-10-23: Decided. Records the sync as it stood and adds peer dependencies.
