# 0023. Config is layered, typed by a class, and overridden from the environment

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

`ConfigurationService` refused two sources that shared a section, so the environment couldn't override part of a YAML file, and it copied a section onto its class shallowly, losing nested defaults. Nothing checked types, so a bad value failed far from its cause.

## Decision

- **Layers:** the class's field values, then each source in the order given to `config(...)`. Objects and named lists merge; any other list, and a scalar, replaces. It is the merge the YAML files already used.
- **The environment is a source**, `EnvDataSource`, listed explicitly, so an app shows what it reads. `SECTION__KEY_NAME` means `section.keyName`. Only upper-case names with `__` count.
- **A schema is a `static schema` on the class**, in JSON Schema, checked with AJV. Types coerce, because environment values are text.
- **Errors name the path and the rule, never the value**, which may be a secret ([ADR 0002](0002-secrets-from-the-environment.md)).
- **`configSection(Type)` checks at boot** and makes the section injectable by its class.

Rejected:

- **Decorators for the schema.** `@Field` belongs to `http`, which `config` must not depend on, and a plain object keeps the class readable.
- **Reading the environment by default.** It would hide a source. A preset can list it for you.
- **Setting list entries from the environment.** Names like `DATABASE__DATASOURCES__0__HOST` are fragile; `${VAR}` placeholders in the YAML already do this.

## Consequences

- Any variable shaped like `SECTION__KEY` becomes config once `EnvDataSource` is listed. It's only read if something asks for that section.
- A section is checked only when something asks for it, so a section with no `configSection` can fail after boot.
- `config` depends on `ajv`.

## History

- 2026-11-06: Decided.
