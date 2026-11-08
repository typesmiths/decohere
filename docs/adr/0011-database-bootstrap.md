# 0011. Database bootstrap: trust is declared, schemas are bootstrapped, each database once

- **Status:** Proposed
- **Date:** 2026-10-15 · updated 2026-11-08

## Context

A data provider can bootstrap a data source at startup (the code is `@decohere/data-postgres`, passed to the provider as `bootstrap`): create its database, an app role and an optional migrate role, and grant them least privilege. It fell short in four ways:

- Every grant went to `public`, ignoring the data source's `schema`, so an app with one schema per module in one database needed its own bootstrap.
- After the first run the migrate role owns the database, and the admin may no longer grant on it. Postgres checks that even for a grant that changes nothing, so a second run could fail.
- A passwordless server was inferred from development plus a missing password, so a password left out by mistake looked like a trusted server and failed later, less clearly.
- Data sources were bootstrapped in parallel, so several on one database raced to create it.

## Decision

- **`auth`** on a data source: `password` (default) or `trust`, named as in pg_hba. Only `trust` lets passwords be left out, and it is refused outside development. A missing password without it is an error in every environment, naming the data source and field.
- **`schema`** (default `public`): bootstrap creates it when missing, owned by the database owner (the migrate role, if any), and grants the app role USAGE, plus CREATE with `synchronize`. Default privileges from the migrate role apply there. TypeORM gets the same `schema`.
- **Grant only what is missing**: each grant is preceded by a `has_*_privilege` check, so a rerun changes nothing.
- **The admin borrows the owner's rights**: for one run the admin is made a member of the migrate role and the database owner where it is not already, and exactly that is revoked at the end, even on failure. Keeping the admin a member for good was rejected: it would hold every app database's rights.
- **`bootstrapDataSources(dataSources, { applicationName })`** is exported from `@decohere/data-postgres` (as `postgres.bootstrap`). A provider (`typeOrm()`, `mikroOrm()`) given it as `bootstrap` calls it once before any connection opens; runners and scripts that open their own connection can call it directly. The checks on `auth` and `synchronize` live in `@decohere/data` and run in every provider, with or without a bootstrap. A data source that asks to be set up while the provider has no bootstrap stops startup with an error that says what to install. It groups data sources by server and database and bootstraps each group once, in order. Data sources in a group must agree on `auth`, `adminUser` and `migrateUsername`. `PostgresServerManager` stays internal.

## Consequences

- An app with one schema per module only maps modules to schemas; the bootstrap is the framework's.
- A config that relied on development to excuse a missing password fails at startup until it sets `auth: trust` or a password.
- `synchronize` is refused outside development, like `auth: trust`, because it can drop columns and data on boot. Anything but `false` or absent counts as on, since TypeORM treats the text "false" as true.
- The migrate role gets no explicit `GRANT ALL ON DATABASE`: it owns the database.
- If the database is owned by a role the admin cannot become, bootstrap stops with an error saying so.
- Scaffolded projects use this: their local Postgres has no passwords, `config.dev.yaml` declares `auth: trust`, and `postgres` is the bootstrap admin.
- Not done: providers other than Postgres; other pg_hba methods (`scram-sha-256` and `md5` are both `password`).

## History

- 2026-10-15: Decided. Replaces the NODE_ENV-based passwordless rule.
- 2026-11-06: Scaffolded projects use `auth: trust` locally, with no database passwords. A password set to `null` by a config file means no password.
- 2026-11-06: `withTypeOrm` became the `typeOrm()` plugin ([ADR 0014](0014-package-names.md)).
- 2026-11-07: `synchronize` is refused outside development.
- 2026-11-08: The bootstrap moved from `data-typeorm` to its own package, `@decohere/data-postgres`, which an app installs for its database (the scaffold does, for Postgres) and passes to its provider as `bootstrap`. That package is where all of Decohere's Postgres-only code goes, including the migration runner's lock and history and a development Postgres started on demand. The `auth` and `synchronize` checks moved to `@decohere/data`, so every provider runs them. Not chosen: a subpath of `data` (it would still ship Postgres code to every app), and a `postgres()` plugin of its own (it must come before the provider, and leaving it out can't be detected).
