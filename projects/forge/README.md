# @decohere/forge

Build system (SWC). `forge build --configuration debug` rewrites workspace imports to **source**. `forge build --configuration release` leaves bare specifiers for Node and real `node_modules`.

[Flux](../flux/) (`flux run` / `flux serve`) uses this same compiler in-process — it does not have a second TypeScript pipeline.

`forge build` transpiles without waiting for a whole-workspace typecheck. Run `forge typecheck` independently (including in the background) and require it before shipping. Why executable tests come before static contracts: [testing principles](../../docs/testing/#executable-behavior-before-type-contracts).

With no `tsconfig.json`, `forge typecheck` reads a project as plain `tsc` would, with decorators on because forge and flux compile them by default. A `tsconfig.json` at the workspace root chooses the options for every project without one of its own; forge then limits `lib` to ES2022 and turns off `@types` discovery unless it sets them (`types: ["node"]`), which keeps a backend workspace's check fast. A project with a `tsconfig.json` in its own folder (a site, a browser library) has made its own choices, so `forge typecheck` reads it as `tsc -p` would: what it leaves out means what it means to `tsc` (`lib` follows its `target`, DOM included), and the files its `include` and `files` list are checked beside the project's sources, such as a generated `types.d.ts` that declares the modules its code imports. A project on the workspace's tsconfig is checked on its own sources only, since that tsconfig's `include` was written for the whole repo. `forge build` compiles the project's sources either way.

A project with its own `check` script (`astro check`, `svelte-check`, `vue-tsc`) is checked by that script, not by `forge typecheck`'s compiler: only the framework's checker reads component files (`.astro`, `.svelte`, `.vue`) and virtual modules (`astro:content`). It runs in the project's folder by [the same rule as a project's own `build` script](#projects-with-a-builder-of-their-own), and a failing script fails `forge typecheck`:

```
$ pnpm forge typecheck
Type-checking @app/api
Type-checking @app/site.web with its own check script (pnpm run check)
```

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

### Sites Vite builds: `@decohere/forge/vite`

A site built with Vite or Astro imports workspace packages by name the same way: `import Badge from "@app/ui/Badge.astro"` is `projects/ui/src/Badge.astro`. Vite gets the aliases from a plugin, and `tsc` (your editor, `astro check`) from `tsconfig.paths.json`. No pnpm workspace, no `link:` or `file:` dependencies, and no alias written by hand in the site.

```js
// projects/clubs/lions/web/astro.config.mjs
import { defineConfig } from "astro/config";
import { forgeAliases } from "@decohere/forge/vite";

export default defineConfig({ vite: { plugins: [forgeAliases()] } });
```

```json
// projects/clubs/lions/web/tsconfig.json
{ "extends": ["astro/tsconfigs/strict", "../../../../tsconfig.paths.json"] }
```

Run `forge paths` at the workspace root to write `tsconfig.paths.json`, and again when a package is added (`forge paths --check` fails when it is stale). Don't set `baseUrl` in the site's tsconfig: the generated paths are relative to their own file.

- **Any file resolves**: `.astro`, `.css`, `.svelte`, with Vite's queries (`?inline`) kept, as well as TypeScript (`@app/ui/format` is `format.ts`). A file the package doesn't have is left to Vite, which reports it.
- **The workspace** is the nearest folder above the site with a `.decohere.js`, else the nearest whose `projects/` holds the site. Vite runs in the site's folder, so this is found, not taken from the working directory; `forgeAliases({ workspaceRoot })` names it instead. The plugin also lets Vite's dev server serve files from the whole workspace, not only the site's folder.
- **A new package** needs a restart of `astro dev`; a new file in an existing package doesn't.
- **From the registry instead**: `forgeAliases({ fromRegistry: ["@app/ui"] })` leaves `@app/ui` to `node_modules`, so the site builds against the version it has installed, and the imports stay as they are. `tsc` still reads that package's types from the generated paths, which point at its source.

`forgeBuild()` (`@decohere/forge/vitest`) resolves package names the same way, and compiles TypeScript with forge's SWC on top: that part is for tests, not for a site's build.

## Projects with a builder of their own

A site built by Astro, Vite, Angular or any other tool says so with a `build` script in its own `package.json`. `forge build` runs that script in the project's folder, through the workspace's package manager, instead of compiling the project:

```
$ pnpm forge build --configuration release
Building @app/api
Building @app/site.web with its own build script (pnpm run build)
```

- **The builder owns the output.** It writes where its config says (for Astro and Vite, the project's `dist/`). Forge writes nothing for the project under its own `dist/`, copies none of its files, and doesn't rebuild it in `--watch`: `flux serve` runs its `dev` script instead.
- **A failing script fails `forge build`.** The other projects are compiled first, in the same run.
- **`forge typecheck` does the same with a `check` script** (`astro check`, `svelte-check`): only the framework's checker reads its component files.
- **The builder is found at the workspace root.** Decohere installs once, at the root, so the script runs with each `node_modules/.bin` from the project up to the root on its `PATH`.
- **A script that calls `forge`, `flux` or `decohere` doesn't count**, so forge never calls itself: such a project is compiled as usual.
- **The project stays in the workspace.** Other projects still import it by name, and `forge package` still finds it as a `ui`. Don't list it in `ignoreProjects`.

To import workspace packages by name from the site, add [`forgeAliases()`](#sites-vite-builds-decohereforgevite) to its Vite config. The same rule (`Project.ownScript` in `@decohere/workspace`) decides what `flux serve` hands to a project's `dev` script.

## `forge package`: one folder a plain `node` can run

`forge build --configuration release` keeps bare imports such as `@app/shop.domain`, so a deployable that imports a workspace library cannot run from `dist/release` on its own: there is no workspace package in production, and Node can only find those packages in `node_modules`. `forge package` makes that folder instead of symlinking `node_modules` into `dist` (what `forge link` does, for development).

```bash
forge build --configuration release
forge package @app/shop.api      # one deployable
forge package                    # every project that has a Dockerfile
forge package @app/shop.api --env staging --env production --app worker
```

It copies only the config files this package reads, named `config.{optional app}.{optional env}.yaml`, each if it exists: `config.yaml`, then each `--app`'s, each `--env`'s, and each pair's. `--env` defaults to `production`, so `config.dev.yaml` stays out of the image. `--app` defaults to the project's folder name, which is what generated apps pass to `YamlDataSource`. If one image runs in several environments, list them all: a missing environment file isn't an error, at build or at run time. An app named in code with no file of its own does stop at boot. It logs what it leaves out, and folders inside `config/` always copy. A file at the top of `config/` that fits no pattern stops the package, naming the file.

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

A module deploys its API and its UI as one image: the API serves the UI's build ([`statics` in `@decohere/http`](../http/README.md#serving-a-built-ui)). To put that build in the package, declare the UI project on the deployable in `.decohere.js`, next to `docker`:

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

`forge package @app/shop.api` then copies `projects/shop.web/dist/` to `projects/shop.api/.package/ui/` (real files, never links). The API calls `.statics("/ui/", "ui")` and the Dockerfile stays `COPY .package/ ./`. `forge package` doesn't build the UI itself: `forge build` does, [with the UI's own build script](#projects-with-a-builder-of-their-own), so `forge build && forge package @app/shop.api` is the whole release. If the folder is missing, packaging fails and tells you to build the UI first. `to` must be a new folder inside `.package/` (not `es6`, `node_modules` or `config`). See [ADR 0007](../../docs/adr/0007-serving-a-built-ui-from-http.md).

Design record: [ADR 0006](../../docs/adr/0006-forge-package-deployables.md).

## `forge dependencies`: package manifests from imports

There is one install, from the root `package.json`, and it owns every version. `forge dependencies sync` writes each package's `dependencies` and `devDependencies` from what its code imports, using the root's ranges. `forge dependencies report --fail-on-drift` fails when a manifest differs from what sync would write; CI runs it.

- **Peers** are declared by name in the package's own `peerDependencies`. Sync sets the root's range and keeps them out of the other two lists, even when no code imports them. Mark optional ones in `peerDependenciesMeta` by hand.
- **Under the release configuration**, which scans only shipped code, importing a package the root lists only as a devDependency is an error unless the package declares it a peer.

Design record: [ADR 0017](../../docs/adr/0017-dependency-manifests-from-imports.md).

## `forge link` clears `dist`

`forge link` is a development tool: it symlinks build output into a consumer's `node_modules`. Like `forge build`, it cleans `dist` first. Without `--build` it then links an output folder holding only `package.json` files, so run it with `--build` (or build again afterwards). It is not a way to make a release build runnable; use `forge package` for that.
