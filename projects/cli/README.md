# @decohere/cli

The command line for Decohere. It ships three bins:

- `decohere`: the product CLI. It has every module: `forge`, `flux`, `create`, `add`, `auth0` and `db` (`src/product.ts`).
- `forge`: only [Forge](../forge/README.md), so `forge build` runs `decohere forge build`.
- `flux`: only [Flux](../flux/README.md), so `flux run x.ts` runs `decohere flux run x.ts`.

Each bin reads `--config-file`, `--log-level` and (for `forge` and `flux`) `--root-dir`, sets up Scribe, and builds a `RootModule` from a list of module classes (`ModuleManifest`s from [`@decohere/devkit/cli`](../devkit/README.md)). `RootModule.create` loads the workspace's `.decohere.js`, `ModuleFactory` builds each module's commands and actions on a container, and `app.run(argv)` routes the command line to them.

The scaffolder's modules come from [`@decohere/scaffold`](../scaffold/README.md). `src/scaffold-host.ts` wraps them for the host: `create` and `webapi` run in the scaffolder's container unless this one has the tools, and `add` and `auth0` refuse to run outside the Dev Container. The user-facing commands are in [create's README](../create/README.md).

## `decohere db`

`decohere db <command>` runs an API's own `src/db.ts` from source with Flux, passing the rest of the command line to it: `migrate`, `status`, `revert`, `new`, `generate`. `--api <name>` picks the API (folder or package name) when more than one has a `src/db.ts`. The commands themselves live in the app and in [`@decohere/data`](../data/data/README.md); this CLI only finds and runs the file.

## Layout and tests

`src/` is flat: one file per bin (`cli.ts`, `forge.ts`, `flux.ts`), the root module and command, the module factory, the scaffold host wrappers and the `db` module, command and action.

The canonical suites are `tests/product.integration.spec.ts` (the product CLI's shape), `tests/forge.integration.spec.ts` and `tests/flux.integration.spec.ts`. They run in memory against memfs: `RootModule.create([...])`, then `app.run(["forge", "build"])` ([testing](../../docs/testing/README.md#canonical-suite-ownership)). `tests/*.bin.spec.ts` run a bin as a child process, `tests/db.docker.spec.ts` needs Docker, and `e2e/` drives the built CLI. Specs are in `tests/` today and move beside the code ([ADR 0027](../../docs/adr/0027-code-design.md)).
