# @decohere/forge

Build system (SWC). `forge build --configuration debug` rewrites workspace imports to **source**. `forge build --configuration release` leaves bare specifiers for Node and real `node_modules`.

[Flux](../flux/) (`flux run` / `flux serve`) uses this same compiler in-process — it does not have a second TypeScript pipeline.

`forge build` transpiles without waiting for a whole-workspace typecheck. Run `forge typecheck` independently (including in the background) and require it before shipping. Why executable tests come before static contracts: [testing principles](../../docs/testing/#executable-behavior-before-type-contracts).

## Debug path aliases (not `node_modules` links)

Forge debug (`aliasPaths: true`) asks the workspace package for a map of `package.json` `name` → source `main` (`Workspace.getPackageAliases`) and feeds it to SWC as `jsc.paths`. Flux uses the same map in its resolve hook only, and compiles without `jsc.paths` or `resolveFully`, so imports are resolved once.

`tsc` can't read the workspace alias map, and without `node_modules` links it finds workspace packages only through tsconfig `paths`. `forge paths` writes the map to `tsconfig.paths.json` for the root tsconfig to extend, and `forge paths --check` fails when the file is out of date.

That is a **debug** rule. Release does not rewrite aliases: production must resolve like any other Node app (installed packages, `exports` / `main` pointing at emitted JS).

### Why aliases instead of workspace symlinks

npm/pnpm/yarn already put workspace packages in `node_modules` as symlinks. Node then follows `exports` / `main` — the **published** shape. That is correct after `forge` release. It is the wrong graph while you are editing `.ts`:

- Specifiers land on built JS (often missing or stale) instead of the file you saved.
- Flux’s HMR map is keyed by workspace project paths (`projects/…/src/…`). A `node_modules/@scope/pkg/…` URL is a different path, so the load hook and the watch graph miss it.
- The installer layout (hoist vs isolated, which packages got linked) becomes a second workspace graph next to `@decohere/workspace`'s. Those drift.

Aliases always point at source `main`. Adding a package is discovering its `package.json`; debug does not wait on a reinstall. `forge link` is a different job: symlink **emit** into a consumer’s `node_modules`. Do not use that for Flux/debug source.

### Where a symlink fails

You edit a library and the API imports it by package name:

```
package.json
node_modules/
  @app/
    shop.domain -> ../../projects/shop.domain     # installer symlink
projects/
  shop.domain/
    package.json     # name: @app/shop.domain
                     # exports.import: ./es6/src/index.js   (published shape)
    src/index.ts     # you save here
  shop.api/
    package.json     # main: main.ts
    main.ts          # import { x } from "@app/shop.domain"
```

```
shop.api/main.ts
  import "@app/shop.domain"
       │
       ▼
  node_modules/@app/shop.domain          (symlink)
       │
       ▼
  projects/shop.domain/package.json
  exports → ./es6/src/index.js           missing, or last release — not src/index.ts
```

Node never opens `projects/shop.domain/src/index.ts`. Flux is watching that file; the running API does not load it.

### Where the alias succeeds

Same tree, debug compiler (Forge SWC / Flux):

```
shop.api/main.ts
  import "@app/shop.domain"
       │
       ▼
  Workspace map: "@app/shop.domain" → projects/shop.domain/src/index.ts
       │
       ▼
  SWC transpile + Flux HMR graph     (same path the workspace watches)
```

Save `src/index.ts` → Flux reboots `shop.api`. No pre-build of `shop.domain`, no `node_modules` link required for that import.

## `forge package`: one folder a plain `node` can run

`forge build --configuration release` keeps bare imports such as `@app/shop.domain`, so a deployable that imports a workspace library cannot run from `dist/release` on its own: there is no workspace package in production, and Node can only find those packages in `node_modules`. `forge package` makes that folder instead of symlinking `node_modules` into `dist` (what `forge link` does, for development).

```bash
forge build --configuration release
forge package @app/shop.api      # one deployable
forge package                    # every project that has a Dockerfile
```

Only a **deployable** can be packaged: a project with a Dockerfile (`docker.dockerfile` in `.decohere.js`, default `Dockerfile` — the same rule `forge docker` uses). A library is refused with a message; libraries are packaged into the deployables that import them, which is also how `"private": true` libraries reach production.

It writes `<project>/.package/` (inside the project, because `forge docker` uses the project folder as the Docker build context):

```
projects/shop.api/.package/
  package.json                  the declared third-party dependencies, pinned to the installed versions
  node_modules/                 `npm install --omit=dev --no-bin-links`: real folders, no symlinks
    @app/shop.domain/           copy of the library's es6/ output + a package.json whose exports point at es6/
  es6/                          the deployable's own compiled code
  config/                       the workspace's config/ folder (YamlDataSource reads ./config)
```

- **Which libraries.** Forge walks the compiled import graph from the deployable's `main`, following relative imports and bare imports that the workspace package resolves to a workspace project (including subpath `exports` such as `@app/kernel/testing`, and transitively through copied libraries). Only those libraries are copied. A library nothing reaches, and its dependencies, stay out.
- **Which third-party packages.** What is **declared** ships: the union of `dependencies` (never `devDependencies`) of the deployable, every copied library and the workspace root `package.json`. They do not have to be imported, so a module loaded by name at run time (a pino transport `target: "pino-roll"`) ships as long as it is declared. Removing dependencies nothing uses is the author's job; a warning-only unused-dependency analysis is planned.
- **Versions.** Each shipped package is pinned to the exact version installed in the workspace (so the image runs what the tests ran). A declared package that is not installed fails the command.
- **Imports that would crash.** If packaged code imports a third-party package that is only a `devDependency`, or declared nowhere, the command fails and names the package and who imports it.
- **Install first, copy second.** `npm` removes folders it does not know, so the libraries are copied in after it runs. `npm` (not pnpm) is used because it writes real folders. The command fails if the output holds any symlink.
- **Limits.** Libraries are found only through static imports (and dynamic imports with a literal specifier). A library loaded by a computed name is not copied.

The Dockerfile then needs no install step and no npm token:

```dockerfile
COPY .package/ ./
CMD ["node", "es6/src/main.js"]
```

`forge docker` does not package for you: Dockerfiles that do not use `.package/` (the `create` and Dev Container images here) must keep building as before. If a Dockerfile copies `.package/` and it does not exist, `forge docker` stops before Docker runs and tells you to run `forge package <project>`.

### Shipping the UI with the API

A module deploys its API and its UI as one image: the API serves the UI's build ([`withStatic` in `@decohere/http`](../http/README.md#serving-a-built-ui)). To put that build in the package, declare the UI project on the deployable in `.decohere.js`, next to `docker`:

```js
/** @type {import("@decohere/workspace").WorkspaceOptions} */
export default {
	projects: {
		"@app/shop.api": {
			ui: {
				project: "@app/shop.web", // the UI project (package name)
				output: "dist",           // its build output, relative to that project. Default: "dist"
				to: "ui",                 // folder inside .package/. Default: "ui"
			},
		},
	},
};
```

`forge package @app/shop.api` then copies `projects/shop.web/dist/` to `projects/shop.api/.package/ui/` (real files, never links). The API calls `.withStatic("/ui/", "ui")` and the Dockerfile stays `COPY .package/ ./`. `forge package` does **not** build the UI: if the folder is missing it fails and tells you to build the UI first. `to` must be a new folder inside `.package/` (not `es6`, `node_modules` or `config`). Running the UI's own toolchain from `forge build` is not done yet; see [ADR 0007](../../docs/adr/0007-serving-a-built-ui-from-http.md).

Design record: [ADR 0006](../../docs/adr/0006-forge-package-deployables.md).

## `forge dependencies`: package manifests from imports

There is one install, from the root `package.json`, and it owns every version. `forge dependencies sync` writes each package's `dependencies` and `devDependencies` from what its code imports, using the root's ranges. `forge dependencies report --fail-on-drift` fails when a manifest differs from what sync would write; CI runs it.

- **Peers** are declared by name in the package's own `peerDependencies`. Sync sets the root's range and keeps them out of the other two lists, even when no code imports them. Mark optional ones in `peerDependenciesMeta` by hand.
- **Under the release configuration**, which scans only shipped code, importing a package the root lists only as a devDependency is an error unless the package declares it a peer.

Design record: [ADR 0017](../../docs/adr/0017-dependency-manifests-from-imports.md).

## `forge link` clears `dist`

`forge link` is a development tool: it symlinks build output into a consumer's `node_modules`. Like `forge build`, it cleans `dist` first. Without `--build` it then links an output folder holding only `package.json` files, so run it with `--build` (or build again afterwards). It is not a way to make a release build runnable; use `forge package` for that.
