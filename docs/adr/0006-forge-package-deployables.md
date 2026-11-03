# 0006. `forge package`: a deployable and the libraries it reaches in one folder, installed with npm, no symlinks

- **Status:** Proposed
- **Date:** 2026-10-12 · updated 2026-10-21

## Context

`forge build --configuration release` keeps bare imports such as `@app/kernel` on purpose: release output "must resolve like any other Node app". In development Flux and the Vitest plugin resolve workspace packages from source through the workspace package. In production there is no workspace package, so `node dist/release/projects/shop.api/es6/src/main.js` fails with `ERR_MODULE_NOT_FOUND` as soon as the API imports a workspace library.

Apps worked around it with symlinks into `node_modules` (`forge link`, trading's Dockerfile, the scaffolded Dockerfile that never made the libraries resolvable at all). A symlinked `node_modules` is a second workspace graph next to the workspace package's: second-order dependencies resolve from wherever the link target sits, and development and production resolve differently.

## Decision

`forge package [project]` turns a deployable's release build into `<project>/.package/`, one folder that plain `node` runs.

- **Only deployables.** A deployable is a project with a Dockerfile (`docker.dockerfile` in `.decohere.js`, default `Dockerfile`), the rule `forge docker` already uses; both ask one function (`packaging/deployable.ts`). A library is refused with a message. Libraries are packaged into the deployables that import them, which is how `"private": true` libraries (not on npm) reach production. With no argument, every deployable is packaged.
- **Walk the compiled import graph only to choose libraries.** From the deployable's `main` (release `es6/` output) it follows relative imports and bare specifiers that the workspace package resolves to a workspace project, including subpath `exports` (`@app/kernel/testing`) and transitively through the copied libraries. Which packages exist, their manifests, and their release output paths come from the workspace package (`Workspace.getProjects`, `Project.getOutDir`); the walker re-derives none of it. A library nothing reaches is not copied and its dependencies stay out.
- **Declared dependencies ship.** The third-party packages in the output are the union of `dependencies` (never `devDependencies`) of the deployable, every copied library, and the workspace root manifest. They need not be imported. Real consumers (Ledger) declare everything in the root manifest and nothing in the project manifests, and some packages are loaded by name at run time, so import analysis would both miss and invent dependencies. Workspace libraries are never installed from a registry, even if listed.
- **Imports that would crash are errors.** Code that imports a third-party package that is only a devDependency, or declared nowhere, fails the command. This guards against a crash in production; it is not tree shaking.
- **Output.** `package.json` listing the declared third-party packages; `node_modules/` from `npm install --omit=dev --no-bin-links`; `node_modules/@scope/<lib>/` holding a copy of each reached library's `es6/` and a `package.json` whose `exports` point at `es6/`; the deployable's own `es6/`; the workspace `config/` (`YamlDataSource` reads `./config`). The output goes inside the project because `forge docker` uses the project folder as the Docker build context. The Dockerfile is `COPY .package/ ./` and `CMD ["node", "es6/src/main.js"]`, with no install step and no npm token in the image build.
- **npm, not pnpm, for the install.** npm writes real folders; `--no-bin-links` removes the `.bin` symlinks. (pnpm with `node-linker=hoisted` also writes real folders, but it would read the workspace's pnpm settings and lockfile, which is the second graph again.) Libraries are copied in after the install, because npm removes folders it does not know. The command fails if the result contains a symlink.
- **Pin to what the tests ran.** Each shipped third-party package gets the exact version installed in the workspace, looked up from the declaring manifest's folder upward as Node would. A declared package that is not installed, or installed at different versions for different declarers, fails with a message naming the package. We do not ship the workspace lockfile: it describes the whole workspace and pnpm's format, not this folder.
- **Library `exports` are generated inside the packager.** Each copied library's `exports` are its own `exports` (or `main`) with every path pointed at `./es6/...js` (the `import` condition wins; `types` is dropped). This overlaps generating or validating `exports` for the release layout, for `forge publish`, which is not solved here: the code lives in `packaging/release-exports.ts` so a future exports sync can reuse it or replace it.
- **`forge docker` does not package first.** It fails before Docker runs, with the command to run, when the Dockerfile copies `.package/` and the folder does not exist. Packaging first would run on every Dockerfile, including those that never use `.package/` (this repo's `create` and Dev Container images), and would add a build-time dependency on a release build to a command that today only runs Docker. A check keyed to the Dockerfile's own `COPY .package/` costs one file read and cannot break an existing image.
- **Scaffold.** Each scaffolded API gets `projects/<name>/Dockerfile` (the build context is the project folder) and a `package` / `package:<name>` script (`pnpm run build && forge package ...`). CI runs `pnpm run package` on the default branch.

## Consequences

- A deployable runs from `.package/` the same way in a container and on a laptop, and a workspace library no longer needs a symlink, an installer layout, or a hand-written manifest rewrite.
- Declared is shipped, so a dependency nobody uses still lands in the image. Removing unused dependencies is the author's job. A tool that only warns about them (tree-shaking analysis) is a separate, later piece of work.
- A library loaded by a computed name, or a dynamic import with a non-literal specifier, is not seen by the walker and its library is not copied (the walker logs a warning for the latter).
- Only the top-level third-party versions are pinned; their own dependencies float within their ranges at package time. Shipping a lockfile would fix that and is not done here.
- Hosts that build the image from a git clone (Railway, Fly) no longer get a working image from `docker build` alone, because `.package/` is build output. The image is built in CI after `forge package`, or the host runs the package step first. This is the price of removing the install step and the npm token from the image build.
- Packaging needs the npm registry (and an npm token for private packages) on the machine that runs it, not in Docker.
- The Docker image build itself is not covered by an automated test here: the e2e test proves the packaged folder runs with plain `node` and holds no symlinks; a `docker build` of that folder is a `COPY` and a `CMD`.

## History

- 2026-10-12: Decided.
- 2026-10-12: Packaging ships declared dependencies (deployable, copied libraries, workspace root) instead of the packages the import walk reaches; the walk now only chooses libraries, and an import of an undeclared or devDependency-only package stays an error. Unused-dependency analysis is deferred.
- 2026-10-21: Package names updated to the plain names of [ADR 0014](0014-package-names.md). The decision is unchanged.
