# 0006. `forge package`: a deployable and the libraries it reaches in one folder, installed with npm, no symlinks

- **Status:** Proposed
- **Date:** 2026-10-12

## Context

`forge build --configuration release` keeps bare imports such as `@app/kernel`, so release output resolves like any Node app. In development Flux and the Vitest plugin resolve workspace packages to source through `@decohere/workspace`. In production nothing does, so `node .../es6/src/main.js` fails with `ERR_MODULE_NOT_FOUND` as soon as the API imports a workspace library.

Apps worked around this with symlinks into `node_modules`. A symlinked `node_modules` is a second dependency graph beside the workspace's: second-order dependencies resolve from wherever the link points, and development and production resolve differently.

## Decision

`forge package [project]` turns a deployable's release build into `<project>/.package/`, a folder plain `node` runs.

- **Only deployables.** A deployable is a project with a Dockerfile (`docker.dockerfile` in `.decohere.js`, default `Dockerfile`), the same rule `forge docker` uses (`packaging/deployable.ts`). A library is refused. Libraries, including `"private": true` ones, reach production inside the deployables that import them. With no argument, every deployable is packaged.
- **The compiled import graph chooses libraries, nothing else.** From the deployable's release `main` it follows relative imports and bare specifiers that resolve to a workspace project (including subpath `exports`), transitively. Projects, manifests and output paths come from `@decohere/workspace`. A library nothing reaches is not copied, and its dependencies stay out.
- **Declared dependencies ship.** The third-party packages shipped are the union of `dependencies` (never `devDependencies`) of the deployable, each copied library and the root manifest, imported or not. Some packages are loaded by name at run time, so import analysis would both miss and invent dependencies. Workspace libraries are never installed from a registry.
- **Imports that would crash are errors.** Shipped code that imports a third-party package that is only a devDependency, or declared nowhere, fails the command.
- **Output.** `package.json` listing the third-party packages; `node_modules/` from `npm install --omit=dev --no-bin-links`; `node_modules/@scope/<lib>/` holding each reached library's `es6/` and a `package.json` whose `exports` point at it; the deployable's own `es6/`; the workspace `config/` (`YamlDataSource` reads `./config`). It sits inside the project because `forge docker` uses the project folder as the build context. The Dockerfile is `COPY .package/ ./` and `CMD ["node", "es6/src/main.js"]`: no install step, no npm token in the image build.
- **npm, not pnpm, installs.** npm writes real folders, and `--no-bin-links` drops the `.bin` symlinks. pnpm (even with `node-linker=hoisted`) would read the workspace's settings and lockfile, the second graph again. Libraries are copied in after the install, because npm removes folders it does not know. The command fails if the result holds a symlink.
- **Pin to what the tests ran.** Each shipped package gets the exact version installed in the workspace, looked up from the declaring manifest's folder as Node would. A declared package that is not installed, or installed at different versions for different declarers, is an error. The workspace lockfile is not shipped: it describes the whole workspace, in pnpm's format.
- **Library `exports` are rewritten by the packager** (`packaging/release-exports.ts`): each path points at `./es6/...js`, the `import` condition wins, `types` is dropped. Generating `exports` for `forge publish` is not solved here; that code can reuse or replace this.
- **`forge docker` does not package first.** When the Dockerfile copies `.package/` and the folder is missing, it fails before Docker runs and names the command to run. Packaging first would run for every Dockerfile, including images that never use `.package/` (this repo's `create` and Dev Container), and would tie a Docker command to a release build.
- **Scaffold.** Each scaffolded API gets `projects/<name>/Dockerfile` and `package` / `package:<name>` scripts (`pnpm run build && forge package ...`); the scaffolded CI runs `pnpm run package` on the default branch.

## Consequences

- A deployable runs from `.package/` the same way in a container and on a laptop, with no symlinks or hand-written manifest rewrites.
- Declared means shipped: an unused dependency still lands in the image. Removing it is the author's job; a tool that warns about it is later work.
- A library loaded by a computed name, or by a dynamic import with a non-literal specifier, is not seen and not copied (the latter logs a warning).
- Only top-level third-party versions are pinned; their own dependencies float within their ranges.
- Hosts that build from a git clone (Railway, Fly) no longer get a working image from `docker build` alone, because `.package/` is build output. Build the image in CI after `forge package`, or run the package step on the host first.
- Packaging needs the npm registry (and a token for private packages) where it runs, not in Docker.
- The e2e test proves the packaged folder runs with plain `node` and holds no symlinks. The `docker build` itself (a `COPY` and a `CMD`) is not tested.

## History

- 2026-10-12: Decided.
- 2026-10-12: Ship declared dependencies (deployable, copied libraries, root) instead of what the import walk reaches; the walk only chooses libraries, and an import of an undeclared or devDependency-only package stays an error.
