# 0026. New apps start from a recipe the scaffolder writes into the app, and tests start them with startTestApp

- **Status:** Proposed
- **Date:** 2026-11-10

## Context

A new API needs a provider, a config plugin with two sources, a health plugin, an OpenAPI title and logging, each named and imported on its own. Decohere is meant to be progressive: a new app should run in minutes, and a grown app should use only what it needs and swap any part, such as the HTTP provider, which `http(provider, …)` already takes.

A preset plugin, `webApi()`, was built first: one call that wired Fastify, YAML and environment config, Pino, health and OpenAPI. It made `app.ts` shorter but hid the composition, and it hard-wired one vendor per part. A web API on another HTTP provider, or with another logger, would need a second preset, and each combination one more package.

Testing had a gap of its own. The HTTP package's suites started apps on a free port through a helper in its `tests/` folder, and `@decohere/http/testing` could only boot a list of controllers. An app had no public way to start itself in a test, so a new project shipped no test.

## Decision

- **A recipe is code the scaffolder writes into the app**, not a package or plugin the app imports. Today there is one: a web API on Fastify. Its `src/app.ts` spells out the composition in `createApp()`: Pino logging (pretty and a rolled file in development), `http(FastifyProvider, { controllers, openApi })`, `config(new YamlDataSource({ app }), EnvDataSource)` and `health()`. The app owns it: swapping the provider or the logger is editing that line ([architecture §4](../architecture/README.md#4-progressive-new-apps-start-from-a-recipe-the-app-owns)).
- **More recipes are more scaffolder templates**, such as another HTTP provider or a worker without HTTP. No package wires several packages together.
- **`main.ts` is five lines:** it calls `createApp()` and starts it. Logging is set in `createApp()`, so the db commands, which build the app without starting it, log the same way.
- **`startTestApp(app)` in `@decohere/http/testing` owns starting an app for a test:** `127.0.0.1:0`, no signal handlers, the advertised origin as `baseUrl`, and `await using` (or `stop()`) to dispose. A failed start stops the app and rethrows. `bootModule` builds an app of some controllers on the provider it is given and calls it, and the HTTP package's own suites use it.
- **New projects get `tests/hello.controller.spec.ts`**, which boots the Hello controller with `bootModule` and calls it over HTTP. It brings its own config (`EnvDataSource`), a test secret for `auth()`, and a stand-in for anything that would need a database, so it passes in a new project without Docker.

## Consequences

- A new app reads as what it is made of, and changing a part is a normal code change. `app.ts` is about fifteen lines instead of three.
- When a recipe improves, existing apps don't get the change for free: they edit their `app.ts`, or a `decohere add` step updates it.
- The recipe is text in the scaffolder for now, like the rest of its output. The generated-app types test type-checks it against the release build. Checked-in template files are a separate change.
- `@decohere/http` installs neither config nor a logging library.
- Rejected: the `webApi()` preset, at `@decohere/http/web-api` or in a package of its own. It hid the composition, tied each part to one vendor, and every HTTP user would have installed config and Pino.
- Not done: a testing module that overrides services inside a built app. Registering a stand-in under the class with `bootModule` covers the generated spec.

## History

- 2026-11-10: Decided: the scaffolder's web API recipe with a five-line `main.ts`, `startTestApp`, and a sample spec. A `webApi()` preset was built first and dropped before merge.
- 2026-11-10: `bootModule` takes `provider` as required instead of defaulting to Fastify, which moved to `@decohere/http-fastify` ([ADR 0014](0014-package-names.md)), so `@decohere/http/testing` installs no web server. The generated spec passes `FastifyProvider`, as `app.ts` does. Not chosen: a Fastify-defaulting `bootModule` in `@decohere/http-fastify/testing`, a second helper that hides the one choice `app.ts` spells out.
