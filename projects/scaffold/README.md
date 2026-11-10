# @decohere/scaffold

The `decohere create` and `decohere add` commands. Users run it through [`@decohere/create`](../create/README.md), whose README says what a new project gets; this page is how the scaffolder makes it.

## Output is checked-in files

Everything the scaffolder writes is a real file under `templates/`, laid out as it lands in a workspace. Nothing is built from strings at run time.

```
templates/
  workspace/            what every new workspace starts with: Dev Container, CI, lint, tsconfig, README
  recipes/
    webapi/             a complete app: a web API on Fastify
      config/config.app-name.yaml
      package.json      what the app adds to the workspace's package.json (its scripts and dependencies)
      projects/app-name/
        src/app.ts      createApp(): the composition, every part written out
        src/main.ts     starts it
        tests/hello.controller.spec.ts
  steps/
    postgres/           what `decohere add postgres` adds, whatever the ORM
    mikro-orm/          … with MikroORM (the default)
    typeorm/            … with TypeORM
    auth0/              what `decohere add auth0` adds
    users/              what `decohere add users` adds, whatever the ORM
    users-mikro-orm/
    users-typeorm/
```

- **A recipe is a working app.** `tests/recipes.spec.ts` imports each recipe's `createApp()` from where it sits, starts it and calls `GET /hello`; its own `tests/` run in `pnpm test`; the repo type-checks and lints it like any other code. A second recipe (another HTTP provider, or a worker with no HTTP) is another folder under `recipes/`.
- **A step is the files it adds**, plus its edits to `app.ts` in `src/steps/<name>.step.ts`. Its files are parts of an app, not whole ones, so the repo's `tsc` and `pnpm test` leave `templates/steps/` out. `e2e/generated-app-types.e2e.spec.ts` generates an app with every step on top of the recipe, once per ORM, and type-checks it against the release build.
- **Placeholders are names that still compile.** In paths and text, `workspace-name`, `app-name` and `app-port` become the project's name, the app's folder and its port; `workspace_name` and `app_name` the same as Postgres identifiers; `APP_NAME` the app's environment prefix; `decohere-devcontainer-image` the Dev Container image at this version. Every `@decohere/*` dependency in a template `package.json` gets this package's version, so `"*"` is fine there. `_gitignore` and `_env` land as `.gitignore` and `.env`, which npm and git would drop from the package.
- **A step's migration** is named `00000000-000000-<name>.ts`. It is written once per app, stamped with the time, and the app's `src/migrations/index.ts` is rewritten to list every migration in the folder, as the db commands do.

## Applying a template

`templates.apply` (`src/templates/templates.ts`) copies one folder for one app into a `WorkspaceChanges`, which holds every write in memory until `commit()`, so `--dry-run` can list them. For each file:

| The workspace | What happens |
|---|---|
| doesn't have it | written |
| has it, and it's JSON, YAML, `.env`, an ignore list, Markdown, or `.devcontainer/Dockerfile` | merged by `src/templates/merge.ts`, which only adds: keys and list items it lacks (YAML list items with a `name` match by it), variables, lines, `##` sections, Docker steps before the last `USER` |
| has it, it's source, and it's exactly what a folder in the step's `replaces` writes | replaced |
| has it otherwise | left alone; the user is told where the step's version is |

Edits to `app.ts` (`src/steps/app-source.ts`) each say whether they are done, how to make them in the shape the recipe generates, and what to add by hand. A file gets all of a step's edits or none, and the user gets every missing line.

## Adding a step

1. Put its files under `templates/steps/<name>/`, laid out as in a workspace, with a `projects/app-name/package.json` that records `"decohere": { "steps": ["<name>"] }`.
2. Write `src/steps/<name>.step.ts`: apply its folders for each app, then its `app.ts` edits.
3. Add the command in `src/program.ts` and the `add` module, and a `create` option if new projects should be able to start with it.
4. Test it once on top of the recipe in `tests/add-steps.integration.spec.ts` (what it adds, that a second run changes nothing, `--dry-run`, a hand-edited `app.ts`), and add it to the apps `generated-app-types.e2e` type-checks.

## Shipping the templates

`.decohere.js` at the repo root leaves `templates/` out of the package's build and of `forge dependencies sync` (`ignore`), so the recipes' imports aren't the scaffolder's dependencies, and copies it into the package as files (`copyFiles`). The code finds it beside its own `package.json`.
