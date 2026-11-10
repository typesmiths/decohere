# @decohere/data-postgres

Everything in Decohere's data layer that only Postgres needs. An app installs it when its database is Postgres; the scaffold does this for you. Pass it to the provider as `database`:

```ts
import { postgres } from "@decohere/data-postgres";
import { migrations } from "./migrations/index.js";

builder.use(mikroOrm({ entities, database: postgres, migrations })); // or typeOrm({ … })
```

`postgres` is a `DatabaseSupport` from `@decohere/data`: a bootstrap and a migrator.

## Setting up a data source at startup

Before the provider connects, `postgres.bootstrap` does what each data source's config asks:
- creates the database;
- creates an app role and an optional migrate role;
- creates the schema;
- grants each role only what it needs.

Data sources on one server and database are set up once, in order, and running it again changes nothing. The rules (`bootstrap`, `auth: trust`, the admin and migrate roles) are in [ADR 0011](../../../docs/adr/0011-database-bootstrap.md).

A runner or script that opens its own connection can call `bootstrapDataSources(dataSources, { applicationName })` directly.

## Running migrations

`postgres.migrator` runs Decohere's migrations ([`@decohere/data`](../data/README.md#migrations)) on a plain `pg` connection:

- as the data source's migrate role (`migrateUsername`), or its app role when it has none, with `search_path` set to its schema;
- with the history in a `decohere_migrations` table (`id`, `applied_at`) in that schema, created on the first run;
- holding a session advisory lock on that table's name for the whole run. A second instance starting at the same time waits, then finds nothing to do;
- in one transaction per migration. A failed migration is rolled back and not recorded, and the run stops with a `MigrationError` that names it.

`revert` undoes the most recently applied migration. It refuses one with no `down`, or one the code no longer has.

## What else goes here

Other Postgres-only code, as it's built, such as starting a development Postgres on demand. Another database would get a package of its own with the same shape.
