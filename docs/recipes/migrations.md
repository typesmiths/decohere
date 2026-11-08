# Migrations

How to change a Decohere app's database: set up the commands, change the schema in development, migrate in a deploy, and change a schema while the app keeps serving. The format and the commands are in [`@decohere/data`](../../projects/data/data/README.md#migrations); the Postgres runner is in [`@decohere/data-postgres`](../../projects/data/data-postgres/README.md#running-migrations). A generated app comes set up.

## Set up

Build the app in one file and start it in another, so a command can build it without starting it:

```ts
// src/app.ts: builds the app, starts nothing
import { postgres } from "@decohere/data-postgres";
import { mikroOrm } from "@decohere/data-mikro-orm";
import { migrations } from "./migrations/index.js";

export function createApp() {
	return Builder.create(new ServiceContainerBuilder(), { applicationName: "shop.api" })
		.use(config(new YamlDataSource({ app: "api" }), EnvDataSource))
		.use(mikroOrm({ entities: [OrderSchema], database: postgres, migrations }))
		.build();
}
```

```ts
// src/main.ts
import { createApp } from "./app.js";

const app = await createApp();
await app.start({ port: Number(process.env.PORT ?? 3000) });
```

```ts
// src/db.ts
import { db } from "@decohere/data";
import { createApp } from "./app.js";

const app = await createApp();
try {
	await db.run(app, process.argv.slice(2), { directory: new URL("./migrations/", import.meta.url) });
} finally {
	await app.dispose();
}
```

```ts
// src/migrations/index.ts: rewritten by `db new` and `db generate`
import type { Migration } from "@decohere/data";

export const migrations: Migration[] = [];
```

```json
{ "scripts": { "db": "flux run projects/api/src/db.ts --" } }
```

The data source needs a migrate role in its config (`migrateUsername`, and `migratePassword` unless the server trusts every connection). Generating and running migrations both use it.

## Change the schema in development

1. Change a mapping: add a property to `OrderSchema`.
2. Write the migration from the difference:

   ```bash
   pnpm db generate add-expiry
   # Wrote …/src/migrations/20261110-093000-add-expiry.ts
   ```

   Read it before you apply it. The diff is the ORM's: it can propose a drop and re-create where you meant a rename. Edit the file when it does.
3. Apply it: restart the app with `migrateOnStart: true` in the development config, or run `pnpm db migrate`.

For a change to rows, write the migration by hand:

```bash
pnpm db new backfill-expiry --data
```

It fails until you write its `up`, so an empty one is never recorded as applied. Use `batch` for tables of any size, and resolve the app's services from `container`. Services write through their own connections, outside the migration's transaction, so change rows with `sql`.

`pnpm db status` lists what's applied and pending, and ids in the history that the code no longer has, such as ones applied from another branch. `pnpm db revert` undoes the last one applied.

`synchronize` and `migrateOnStart` can't both be on: with `synchronize` the tables already match the mappings, so `generate` would find nothing to write.

## Migrate in a deploy

Run the migrations as a release step, before the new version takes traffic, with the migrate role's password in its environment:

```bash
node es6/src/db.js migrate     # in the packaged app (forge package)
```

The app's servers then run with the app role only: no migrate password, and `migrateOnStart` off, since it is refused outside development. If two release steps start at once, the second waits for the first's lock and then finds nothing to do. A migration that fails is rolled back, the step fails, and the old version keeps serving.

`db migrate --dry-run` lists what would run, and `--to <id>` stops after that migration.

## Change a schema without downtime: expand, then contract

During a deploy, old and new versions of the app run against the same database. Each release's schema has to work with the code before it and the code after it. So a change that would break the old code is split into two releases:

1. **Expand.** Add what the new code needs, in a form the old code doesn't notice: a nullable column, a new table, a new index. The new code writes both the old shape and the new one, and reads the new one where it is filled.
2. **Fill.** A data migration copies the existing rows into the new shape, in batches. It can run in the expand release, after its schema migration.
3. **Contract.** Once no version that uses the old shape is running, the next release removes it: drop the old column, make the new one `not null`.

For example, splitting `customer_name` into `first_name` and `last_name`:

| Release | Schema migration | Data migration | Code |
| --- | --- | --- | --- |
| 1 | add nullable `first_name`, `last_name` | fill both from `customer_name` | writes all three, reads the new two |
| 2 | `first_name` and `last_name` `not null`, drop `customer_name` | | uses the new two only |

Things that break the old code, so they need the two steps: renaming or dropping a column or table, adding a `not null` column without a default, and narrowing a type. Adding a nullable column, a table or an index needs only one.

Each migration runs in a transaction, so a statement that can't run in one, such as Postgres's `create index concurrently`, can't run in a migration. On a large table, plan a plain `create index` for a quiet time, since it blocks writes while it builds.

## Change provider

The history is Decohere's, not the ORM's, so it stays. Map the entities with the new provider and run `db generate`: the first diff renames the indexes and keys to the new ORM's names. Review it and apply it like any other migration.
