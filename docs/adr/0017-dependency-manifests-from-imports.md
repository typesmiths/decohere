# 0017. Package manifests are generated from imports; the root owns every version; peers are declared by name

- **Status:** Proposed
- **Date:** 2026-10-23

## Context

Decohere is not a pnpm (or npm) workspace. There is one install, from the root `package.json`, and workspace packages resolve to each other's source through the workspace aliases ([ADR 0012](0012-workspace-package-resolution.md)). Each package under `projects/` still needs its own dependency lists for npm, and hand-kept lists drift from what the code imports.

Peers were the gap. A dependency was runtime or dev for every package at once, depending on which root list held it. So `@decohere/testing`, whose shipped code imports `vitest` and `memfs`, published them only as devDependencies, and consumers were not told to install them. `scribe-pino`'s hand-written peers were unchecked and had drifted from the root's versions.

## Decision

- **`forge dependencies sync` writes each package's `dependencies` and `devDependencies` from its imports.** An imported package goes in `dependencies` or `devDependencies` according to the root list that holds it. A workspace package goes in with its own version. An import nothing declares is an error.
- **The root `package.json` owns every version.** Packages never pick their own ranges.
- **A package declares its peers by name in its own `peerDependencies`**, where npm reads them. Sync gives each the root's range, removes it from the other two lists, and keeps it even when nothing imports it (a pino transport is loaded by name). A peer the root does not list is an error. `peerDependenciesMeta` is hand-written and kept.
- **Under a configuration that publishes (`pack: true`, the release configuration), shipped code may not import a root devDependency** unless the package declares it a peer. The release configuration leaves out tests, benchmarks and e2e, so what it scans is what ships. The error names each package and the files that import it.
- **`forge dependencies report --fail-on-drift` compares all three lists** with what sync would write; CI runs it.

Rejected:

- **pnpm workspaces.** Each package would keep its own hand-written list and ranges, and the installer layout would be a second dependency graph beside the workspace aliases ([ADR 0006](0006-forge-package-deployables.md), [ADR 0012](0012-workspace-package-resolution.md)).
- **Declaring peers in `.decohere.js`.** One more place to look. `peerDependencies` is where npm and readers already look; sync only owns the versions.

## Consequences

- A new third-party import means `pnpm add` at the root, then sync. Nothing else in a package's dependency lists is edited by hand.
- A shipped import of a development-only package fails sync and the drift check before publishing, instead of failing a consumer at run time.
- Sync writes keys in a fixed order; the drift check ignores order.

## History

- 2026-10-23: Decided. Records the sync as it stood and adds peer dependencies.
