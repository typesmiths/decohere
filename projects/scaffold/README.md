# @decohere/scaffold

The scaffolder: it writes a new Decohere workspace with one or more web APIs, and adds to an existing one. The commands as a user runs them (`create webapi`, `add api`, `add auth0`, `auth0 login|configure|token`) are in [create's README](../create/README.md). This README is for working on the scaffolder itself.

It runs two ways. The `decohere` product CLI in [`@decohere/cli`](../cli/README.md) loads its modules. Its own `decohere` bin (`src/cli.ts`, built on `src/program.ts`) is what the scaffolder image that `@decohere/create` starts runs.

## How it is built

- **Modules.** `CreateModule` (`create webapi`), `AddModule` (`add api`, `add auth0`) and `Auth0Module` (`auth0 login`, `configure`, `token`) are `ModuleManifest`s from [`@decohere/devkit/cli`](../devkit/README.md): a command class and an action class per subcommand, one per file (`webapi.command.ts`, `webapi.action.ts`, …).
- **Models.** Every file the scaffolder writes is a model of that file, in `src/models/` (workspace files: `package.json`, `tsconfig`, the Dev Container, Compose, VS Code settings, Dockerfiles) and `src/webapi/models/` (an API's files: its `package.json`, `main.ts`, controller, sample spec, migrations, production Dockerfile, CI workflow). Features change the models, then the workspace writes them all at once.
- **Features.** `src/webapi/features/` holds the optional parts of an API: `database.feature.ts` (the data provider and its config), `auth.feature.ts` (Auth0), and `finalize.feature.ts` (installing and formatting after the files are written). Each implements `Feature` from `src/services/scaffold.service.ts`: `getOptions`, then `scaffold`, then an optional `finalize`.
- **The Dev Container base image** is `AppDevContainerBaseImage` in `src/models/docker-image.model.ts`; [`projects/devcontainer/Dockerfile`](../devcontainer/README.md) is generated from it.

## Layout and tests

`src/` holds the modules, commands and actions at the top, with `models/`, `services/`, `domain/` (prompts) and `webapi/` (the web API template: options, features, models, Dev Container scripts).

The canonical suite for the tree it writes is `tests/cli.integration.spec.ts`. A generated app's types are checked by `e2e/generated-app-types.e2e.spec.ts`, against the release build, in CI's `package` job ([testing](../../docs/testing/README.md#canonical-suite-ownership)). Units cover model and contract edges, and `tests/first-migrations.docker.spec.ts` needs Docker. Specs are in `tests/` today and move beside the code ([ADR 0027](../../docs/adr/0027-code-design.md)).
