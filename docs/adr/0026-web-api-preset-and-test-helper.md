# 0026. A web API starts from the webApi() preset, and tests start it with startTestApp

- **Status:** Proposed
- **Date:** 2026-11-10

## Context

A hello-world API needed a provider, a config plugin with two sources, a health plugin, an OpenAPI title and a logging recipe from a separate package, each named and imported on its own. The scaffolder wrote all of it, so every new app started with a `main.ts` its author had to read past, and an app written by hand had to know every piece. Forgetting one failed late: no `config(...)` meant a service could not read its section at the first request.

Testing had the opposite gap. The HTTP package's own suites started apps on a free port through a helper in its `tests/` folder, and `@decohere/http/testing` could only boot a list of controllers. An app had no public way to start itself on a free port in a test, so a new project shipped no test at all.

## Decision

- **`webApi(options)` is a builder plugin**, used with `.use()` like every other part, not a `Builder.webApi()` static: `core` sits below the HTTP package and can't know about it, and a plugin composes with the rest of the chain (`.use(auth())`, `.withServices(...)`). It is named for what it adds ([style](../style/README.md#names)).
- **It adds the usual parts, each overridable or `false`:** `http(FastifyProvider, ...)`, `config(new YamlDataSource({ app }), EnvDataSource)`, Pino logging (pretty and a rolled file in development, JSON in production), `health()` and an OpenAPI document titled with the application name. It only calls the same plugins an app can call itself, so an explicit chain keeps working and an app can leave the preset whenever a part no longer fits.
- **Config files are optional.** `YamlDataSource` already reads each file only if it exists, so an app with no `config/` folder runs on class defaults and environment variables. Naming the app still requires its own file.
- **Logging is set when the preset is applied**, not at start: Scribe is one per process, and the composition root is where it was set before. A tool that builds the app (the db commands) logs the same way the app does.
- **It lives at `@decohere/http/web-api`**, a subpath, so `@decohere/http` itself still loads no Pino and has no import side effects. The HTTP package depends on `config` and `scribe-pino` for it; the vendors stay behind those packages, as before.
- **`startTestApp(app)` in `@decohere/http/testing` owns starting an app for a test:** `127.0.0.1:0`, no signal handlers, the advertised origin as `baseUrl`, and `await using` (or `stop()`) to dispose. A failed start stops the app and rethrows. `bootModule` builds an app of some controllers and calls it, and the HTTP package's own suites use it too.
- **The scaffolder writes `main.ts` in five lines** (`createApp()` from `app.ts`, which uses `webApi()`), and a `tests/hello.controller.spec.ts` that boots the Hello controller with `bootModule` and calls it over HTTP. The spec brings its own config (`EnvDataSource`), a test secret for `auth()`, and a stand-in for anything that would need a database, so it passes in a new project without Docker.

## Consequences

- A new app reads as what it is made of. Turning a part off is `false`, changing it is an option, and anything else is the builder as before.
- `@decohere/http` now installs `@decohere/config` and `@decohere/scribe-pino` (and Pino), even for an app that doesn't use the preset. Splitting the preset into its own package was rejected for now: the HTTP package is where an API starts, and the extra install is small next to Fastify.
- An app that configures Scribe itself must pass `logging: false`, or the preset replaces its setup.
- A test that builds a whole app with `webApi()` starts Pino with it; `bootModule` tests stay quiet. The generated spec uses `bootModule` so it needs nothing outside the process; `startTestApp(createApp())` is the recipe when the whole app should run.
- Not done: a testing module that overrides services inside a built app. Registering a stand-in under the class with `bootModule` covers the generated spec.

## History

- 2026-11-10: The `webApi()` preset and `startTestApp`, with the scaffolder's five-line `main.ts` and sample spec.
