# @decohere/workspace

Workspace and project model for Decohere tooling. Forge and Flux call it to find packages and derive import aliases. It is not a CLI — you do not run it; tools use it internally.

## Workspace layout

A **project** is a directory whose root contains a `package.json`. The workspace package discovers those files with `includeProjects` globs from the workspace root: the folder the tool runs in. Nothing searches the folders above it; to run from elsewhere, pass `--root-dir <dir>` to `forge` or `flux`.

The workspace root may also have a `package.json`. That file is workspace metadata (name/version). It is **not** a project unless it also matches `includeProjects`.

**Standalone projects.** A folder with a `package.json` and no `projects/` folder, and no `includeProjects` of your own, is one project: its root `package.json` is the package, with its sources at the root (build output, `node_modules` and `.git` excluded). Every tool works on that one package; `forge dependencies sync`, `dependencies report` and `paths` have nothing to do, since there is no other package. Adding a `projects/` folder turns it into a monorepo: move the sources into `projects/<name>/` with their own `package.json`.

### Defaults

| Option | Default |
|---|---|
| `includeProjects` | `projects/**/package.json` |
| `ignoreProjects` | `**/node_modules/**`, `**/__fixtures__/**`, `**/dist/**` |
| Source files | `**/*.ts` (not `**/*.d.ts`) |
| Config file | `.decohere.js` if present; otherwise defaults |

Nested `package.json` files under another discovered package are skipped (fixtures inside a project do not become projects).

Default tree:

```
package.json                 # workspace (not a project)
projects/api/package.json    # project
projects/lib/package.json    # project
```

Packages do **not** have to live under `projects/` — that is only the default glob. Override `includeProjects` when the tree is different.

### Optional `.decohere.js`

If the file is missing, the workspace package uses the defaults above. The file overrides the defaults, including a tool's own (forge's `configurations` and `copyFiles`). Arrays in it **replace** the defaults, except `ignoreProjects` and `ignore`, which **add** to them: list only what you leave out.

```js
// Keep a Pulumi program under projects/ out of forge and flux. node_modules, __fixtures__ and dist stay ignored.
export default { ignoreProjects: ["projects/infra/**"] };
```

```js
/** @type {import("@decohere/workspace").WorkspaceOptions} */
export default {
	includeProjects: ["apps/**/package.json", "packages/**/package.json"],
};
```

Per-project settings go under `projects`, keyed by package name: `docker` (image, Dockerfile, tags, build args) and `ui` (the UI project a deployable ships, see [forge](../forge/README.md#shipping-the-ui-with-the-api)).

### A project's own scripts

A project whose `package.json` declares a script for a step has a builder of its own (Astro, Vite, Angular), and Decohere's tools run that script in its folder instead of doing the step: `build` for `forge build`, `check` for `forge typecheck`, `dev` or `serve` for `flux serve`. `Project.getOwnScript(name)` (and `projectScripts.getOwn(scripts, name)`) is that rule, in one place. A script that calls `forge`, `flux` or `decohere` doesn't count: running it would only call the tool again. See [forge](../forge/README.md#projects-with-a-builder-of-their-own).

`--config-file` on `forge` / `flux` selects a different config path. The default is `.decohere.js` in the workspace root (`--root-dir`, else the current folder).

### Package aliases

For each discovered project, the workspace package maps `package.json` `name` to its source entry, and its subpaths to their sources:

- **The entry:** a TypeScript `main` as written (default `src/index.ts`). A `main` or `exports["."]` that describes the published layout (`index.js`, `./es6/src/index.js`) maps back to the source under `src/`.
- **Each subpath in `exports`:** `./auth` → `./es6/src/auth/auth.extensions.js` becomes `src/auth/auth.extensions.ts`. Entries whose source doesn't exist are left out.
- **Any other subpath (`name/*`):** `src/<sub>.ts` (or `.tsx`, `.mts` for `.mjs`, `.cts` for `.cjs`), else `src/<sub>/index.ts`, else `src/<sub>` itself when it is a file (a UI package's `Button.astro` or `theme.css`). A package with only subpaths and no root entry resolves them under `src/`.

Root `tsconfig.json` `paths` override the same keys. In this repo they come from `forge paths`, which writes this map to `tsconfig.paths.json` for `tsc`.

`tsconfig.json` is read with [get-tsconfig](https://github.com/privatenumber/get-tsconfig), which follows `extends`, not with the TypeScript compiler: loading the compiler takes longer than the rest of a `flux run`. Transpiling uses only `paths` and `baseUrl` (made absolute). Forge's type emission, which needs every option as tsc sees it, parses `Tsconfig.filePath` with the compiler itself.

Forge debug and Flux consume this map (SWC `jsc.paths` / resolve hooks). Why debug uses it instead of `node_modules` workspace links: [Forge — debug path aliases](../forge/README.md#debug-path-aliases-not-node_modules-links).

## When to use

| Use `@decohere/workspace` | Do not use it |
|---|---|
| Discover packages and watch their source | A user-facing “run this workspace” CLI (use Flux / Forge) |
| Package-name aliases (`Workspace.getPackageAliases`) | pnpm/npm workspace protocol as the discovery source |
| Shared project model for Forge + Flux | Browser bundler config (Vite / webpack) |

## Programmatic API

```ts
import { WorkspaceFactory } from "@decohere/workspace";

const workspace = await WorkspaceFactory.create({
	configFile: undefined, // workspace defaults; or path to .decohere.js
	rootDir: process.cwd(),
});

const projects = workspace.getProjects("debug");
const aliases = workspace.getPackageAliases("debug");
```

A tool with defaults of its own passes them as the second argument, `WorkspaceFactory.create(options, defaults)`, so `.decohere.js` can override them. Anything in `options` overrides the user's file.

Pass a pre-built `workspace` into Forge/Flux in tests to skip filesystem discovery.
