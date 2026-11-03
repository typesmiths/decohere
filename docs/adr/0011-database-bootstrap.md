# 0011. Database bootstrap: trust is declared, schemas are bootstrapped, each database once

- **Status:** Proposed
- **Date:** 2026-10-15 · updated 2026-10-21

## Context

`data-typeorm` can bootstrap a data source at startup: create its database, an app role and an optional migrate role, then grant them least privilege. Three things fell short:

- Every grant went to `public`, ignoring the data source's `schema`. Ledger gives each module its own schema in one database, so it kept its own copy of the bootstrap.
- After the first run the migrate role owns the database, and the admin no longer may create in it or grant on it. Postgres checks that right even for a grant that would change nothing, so a second run could fail.
- A server that needs no password was inferred: development plus a missing password. A password left out by mistake looked exactly like a trusted server and failed later, less clearly.

The module also bootstrapped each data source in parallel, so data sources on one database raced to create it.

## Decision

- **`auth` on a data source**: `password` (default) or `trust`, named as in pg_hba. Only `trust` lets passwords be left out, and `trust` is refused outside development. A missing password without it is an error in every environment, naming the data source and the field.
- **`schema` on a data source** (default `public`): bootstrap creates it when missing, owned by the database owner (the migrate role, when there is one), and grants the app role USAGE, plus CREATE with `synchronize`. Default privileges from the migrate role apply in that schema. `schema` also goes to TypeORM, so tables land there.
- **Grant only what is missing**: each grant is preceded by a `has_*_privilege` check, so running the bootstrap again changes nothing.
- **The admin borrows the owner's rights**: for one run the admin is made a member of the migrate role and the database owner when it is not already, and given back exactly that at the end, even when the run fails. The alternative, keeping the admin a member for good, was rejected: the admin would then hold every app database's rights.
- **`bootstrapDataSources(dataSources, { applicationName })`** is exported for runners and scripts that open their own `DataSource`; `withTypeOrm` calls it once before any DataSource opens. It groups data sources by server and database and bootstraps each group once, in order. Data sources in a group must agree on `auth`, `adminUser` and `migrateUsername`. `PostgresServerManager` stays internal.

## Consequences

- Ledger can drop its copy of the bootstrap and keep only its module-to-schema mapping.
- A config that relied on development to excuse a missing password now fails at startup until it sets `auth: trust` (or a password).
- The migrate role no longer gets an explicit `GRANT ALL ON DATABASE`: it owns the database, which covers it.
- If the database is owned by a role the admin cannot become (it did not create it, and is not a member), bootstrap stops with an error that says so.
- Not done: bootstrap for providers other than Postgres; other pg_hba methods (`scram-sha-256` and `md5` are both `password` here).

## History

- 2026-10-15: Decided. Replaces the NODE_ENV-based passwordless rule.
- 2026-10-21: Package names updated to the plain names of [ADR 0014](0014-package-names.md). The decision is unchanged.
