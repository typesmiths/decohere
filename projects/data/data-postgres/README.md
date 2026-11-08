# @decohere/data-postgres

Everything in Decohere's data layer that only Postgres needs. An app installs it when its database is Postgres; the scaffold does this for you.

## Setting up a data source at startup

```ts
import { postgres } from "@decohere/data-postgres";

builder.use(mikroOrm({ entities, bootstrap: postgres.bootstrap })); // or typeOrm({ … })
```

Before the provider connects, `postgres.bootstrap` does what each data source's config asks:
- creates the database;
- creates an app role and an optional migrate role;
- creates the schema;
- grants each role only what it needs.

Data sources on one server and database are set up once, in order, and running it again changes nothing. The rules (`bootstrap`, `auth: trust`, the admin and migrate roles) are in [ADR 0011](../../../docs/adr/0011-database-bootstrap.md).

A runner or script that opens its own connection can call `bootstrapDataSources(dataSources, { applicationName })` directly.

## What else goes here

Postgres-only code in general, as it's built: the migration runner's advisory lock and history table, and starting a development Postgres on demand. Another database would get a package of its own with the same shape.
