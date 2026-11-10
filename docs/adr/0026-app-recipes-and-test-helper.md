# 0026. New apps start from a checked-in recipe the app owns, options are add steps, and tests start apps with startTestApp

- **Status:** Proposed
- **Date:** 2026-11-10

## Context

A new API needs a provider, a config plugin with two sources, a health plugin, an OpenAPI title and logging, each named and imported on its own. Decohere is meant to be progressive: a new app should run in minutes, and a grown app should use only what it needs and swap any part, such as the HTTP provider, which `http(provider, …)` already takes.

A preset plugin, `webApi()`, was built first: one call that wired Fastify, YAML and environment config, Pino, health and OpenAPI. It made `app.ts` shorter but hid the composition, and it hard-wired one vendor per part. A web API on another HTTP provider, or with another logger, would need a second preset, and each combination one more package.

Testing had a gap of its own. The HTTP package's suites started apps on a free port through a helper in its `tests/` folder, and `@decohere/http/testing` could only boot a list of controllers. An app had no public way to start itself in a test, so a new project shipped no test.

## Decision

- **A recipe is a complete, working app checked into the scaffolder** (`projects/scaffold/templates/recipes/<name>/`), not a package or plugin the app imports. The scaffolder copies it into the workspace, changing only names and ports. The repo boots each recipe as it is in a test and calls `GET /hello`, runs its tests, and type-checks and lints it like its own code. Today there is one: a web API on Fastify. Its `src/app.ts` spells out the composition in `createApp()`: Pino logging (pretty and a rolled file in development), `http(FastifyProvider, { controllers, openApi })`, `config(new YamlDataSource({ app }), EnvDataSource)` and `health()`. The app owns it: swapping the provider or the logger is editing that line ([architecture §4](../architecture/README.md#4-progressive-new-apps-start-from-a-recipe-the-app-owns)).
- **More recipes are more folders**, such as another HTTP provider or a worker without HTTP. No package wires several packages together.
- **Options are `decohere add` steps, applied on top of a recipe**, at create time and later alike: `add postgres [--orm typeorm]`, `add auth0`, `add users` (needs both), and `add api` for another app. A step is checked-in files (`templates/steps/<name>/`) and a few edits to `app.ts`. It only adds: missing files are copied, manifests, config, `.env`, ignore lists and README sections are merged, and an `app.ts` edit is made only in the shape the recipe generated, else the lines are printed. A sample file is replaced only while it is still exactly what an earlier template wrote. Running a step again changes nothing, `--dry-run` lists what it would change, and each step records itself in the app's `package.json` under `"decohere"`.
- **Tests are a sum, not a matrix:** each recipe once, and each step once on top of the recipe and the steps it needs. The generated-app types test type-checks the recipe alone, and with every step for each ORM, against the release build.
- **`main.ts` is five lines:** it calls `createApp()` and starts it. Logging is set in `createApp()`, so the db commands, which build the app without starting it, log the same way.
- **`startTestApp(app)` in `@decohere/http/testing` owns starting an app for a test:** `127.0.0.1:0`, no signal handlers, the advertised origin as `baseUrl`, and `await using` (or `stop()`) to dispose. A failed start stops the app and rethrows. `bootModule` builds an app of some controllers and calls it, and the HTTP package's own suites use it.
- **New projects get `tests/hello.controller.spec.ts`**, which boots the Hello controller with `bootModule` and calls it over HTTP. It brings its own config (`EnvDataSource`), a test secret for `auth()`, and a stand-in for anything that would need a database, so it passes in a new project without Docker.

## Consequences

- A new app reads as what it is made of, and changing a part is a normal code change. `app.ts` is about fifteen lines instead of three.
- When a recipe improves, existing apps don't get the change for free: they edit their `app.ts`, or a `decohere add` step updates it.
- The scaffolder has no code that writes files from strings: a change to what new apps get is a change to a file that runs. The template folders ship in `@decohere/scaffold` as files, through the repo's `.decohere.js`, which also keeps their imports out of the scaffolder's dependencies.
- A step's files are parts of an app, so the repo's `tsc` and unit tests leave them out; the e2e type-check covers them on a generated app.
- A combination that needs code of its own, such as local user profiles with both Postgres and Auth0, is a step of its own that requires the others, not a branch inside them.
- `@decohere/http` installs neither config nor a logging library.
- Rejected: the `webApi()` preset, at `@decohere/http/web-api` or in a package of its own. It hid the composition, tied each part to one vendor, and every HTTP user would have installed config and Pino.
- Not done: a testing module that overrides services inside a built app. Registering a stand-in under the class with `bootModule` covers the generated spec.

## History

- 2026-11-10: Decided: the scaffolder's web API recipe with a five-line `main.ts`, `startTestApp`, and a sample spec. A `webApi()` preset was built first and dropped before merge.
- 2026-11-10: The recipe became a checked-in app the repo boots, and `create`'s options became `decohere add` steps on top of it, replacing the scaffolder's string models.
