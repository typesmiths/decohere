# 0023. Config is layered, typed by a class, and overridden from the environment

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

`ConfigurationService` refused two sources that shared a section, so the environment couldn't override part of a YAML file, and it copied a section onto its class shallowly, losing nested defaults. Nothing checked types, so a bad value failed far from its cause.

## Decision

- **Layers:** the class's field values, then each source in the order given to `config(...)`. Objects and named lists merge; any other list, and a scalar, replaces. It is the merge the YAML files already used.
- **File names say who a file is for:** `config.{optional app}.{optional env}.yaml`, read as `config.yaml`, `config.<app>.yaml`, `config.<env>.yaml`, `config.<app>.<env>.yaml`, each if it exists, later ones winning. The app is a const in the app's code, `new YamlDataSource({ app: "billing" })`, and `forge package --app` names what to copy. Names are built, never parsed, so `dev` alone can't be misread as an app, and an app named like its environment is refused.
- **`forge package` copies only what the package reads**, for `--env` (default `production`) and `--app` (default the project's folder name). A top-level file that fits no pattern stops it. Folders copy as they are.
- **The environment is a source**, `EnvDataSource`, listed explicitly, so an app shows what it reads. `SECTION__KEY_NAME` means `section.keyName`. Only upper-case names with `__` count.
- **A schema is a `static schema` on the class**, in JSON Schema, checked with AJV. Types coerce, because environment values are text.
- **Errors name the path and the rule, never the value**, which may be a secret ([ADR 0002](0002-secrets-from-the-environment.md)).
- **`configSection(Type)` checks at boot** and makes the section injectable by its class. `config(...)` loads every source at build, so a bad source stops the app before any section is read.
- **Null means unset**, at any depth, so it clears a key: the class's default applies, or `required` fails. Type coercion never sees it, and would otherwise turn it into 0, false or "".
- **Dev values stay out of the base file and class defaults.** `devOnly: true` in a schema refuses a key's value unless `NODE_ENV` is `development` or `dev`, so staging and typos fail. The rule has one home, `isDevelopmentEnv` in `core/system`. It reads which environment the app is deployed to, as `YamlDataSource` and `auth` already do; the host-purity rule is about test and CI branches.
- **Framework schemas refuse undeclared keys**, `api` first.
- **Variables that clash stop the app**, instead of their order choosing a winner.
- **Keys every object inherits are refused**, from any source.

Rejected:

- **An environment variable for the app.** What an app is doesn't change with where it runs, and a const can't be mistyped per deployment.
- **Packaging everything except dev files.** It needs no flags, but the file names would say nothing about who a file is for.
- **Decorators for the schema.** `@Field` belongs to `http`, which `config` must not depend on, and a plain object keeps the class readable.
- **Reading the environment by default.** It would hide a source. A preset can list it for you.
- **Setting list entries from the environment.** Names like `DATABASE__DATASOURCES__0__HOST` are fragile; `${VAR}` placeholders in the YAML already do this.

## Consequences

- Any variable shaped like `SECTION__KEY` becomes config once `EnvDataSource` is listed. It's only read if something asks for that section, and in a section with `additionalProperties: false` an unknown one stops the app.
- A later layer keeps what it doesn't mention, so a value can survive unintentionally. `null` clears it, and `devOnly` catches the unsafe ones.
- A leftover `auth.devStatic` now stops the app outside development, even with a real login strategy configured.
- A section is checked only when something asks for it, so a section with no `configSection` can fail after boot.
- `config` depends on `ajv`.
- An image that runs in several environments or roles must list them when packaging. A file left out isn't an error at run time, so `forge package` logs what it leaves out.

## History

- 2026-11-06: Decided.
- 2026-11-07: Config files are named by app and environment, and `forge package` copies only what a package reads.
- 2026-11-07: Added the guards: null means unset, `devOnly`, undeclared keys, clashing variables, inherited keys, and loading sources at build. Dev values don't belong in the base file or class defaults.
