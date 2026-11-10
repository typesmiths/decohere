# Migrations

How to change a Decohere app's database: set up the commands, change the schema in development, migrate in a deploy, change a schema while the app keeps serving, and move an app over from TypeORM's own migrations. The format and the commands are in [`@decohere/data`](../../projects/data/data/README.md#migrations); the Postgres runner is in [`@decohere/data-postgres`](../../projects/data/data-postgres/README.md#running-migrations). A generated app comes set up.

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

`decohere db <command>` finds the API's `src/db.ts` in the workspace and runs it from source, with the rest of the command line. With more than one API, name it with `--api <folder or package name>`. It reads no `.env` file unless you pass `--env-file` or `--env-file-if-exists`.

The data source needs a migrate role in its config (`migrateUsername`, and `migratePassword` unless the server trusts every connection). Generating and running migrations both use it.

## Change the schema in development

1. Change a mapping: add a property to `OrderSchema`.
2. Write the migration from the difference:

   ```bash
   pnpm decohere db generate add-expiry
   # Wrote …/src/migrations/20261110-093000-add-expiry.ts
   ```

   Read it before you apply it. The diff is the ORM's: it can propose a drop and re-create where you meant a rename. Edit the file when it does.
3. Apply it: restart the app with `migrateOnStart: true` in the development config, or run `pnpm decohere db migrate`.

For a change to rows, write the migration by hand:

```bash
pnpm decohere db new backfill-expiry --data
```

It fails until you write its `up`, so an empty one is never recorded as applied. Use `batch` for tables of any size, and resolve the app's services from `container`. Services write through their own connections, outside the migration's transaction, so change rows with `sql`.

`pnpm decohere db status` lists what's applied and pending, and ids in the history that the code no longer has, such as ones applied from another branch. `pnpm decohere db revert` undoes the last one applied.

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

## Move from TypeORM's migrations

An app that runs TypeORM's own migrations has a second `DataSource` for its CLI, a `tsx` dev dependency, and scripts such as `node --import tsx node_modules/typeorm/cli.js migration:run`. Its databases keep their history in TypeORM's `migrations` table, which Decohere doesn't read. So you convert the migrations, then tell each existing database once that it already has them, with `db baseline`.

1. **Set up the commands** as in [Set up](#set-up), with `typeOrm({ entities, database: postgres, migrations })`. Keep the data source where its tables are: leave `schema` unset when they are in `public`. The migrate role has to own the tables to change them, so make it the user TypeORM's scripts connected as: set `migrateUsername` to it, or leave it unset when the app uses that one user for everything.

2. **Convert each migration** to a file in `src/migrations/`. Take its id from the class name's timestamp, so the migrations keep their order and sort before any you add later:

   ```bash
   node -e 'console.log(new Date(1794327166580).toISOString())'
   # 2026-11-10T16:12:46.580Z → 20261110-161246-init
   ```

   ```ts
   // src/migrations/20261110-161246-init.ts (TypeORM: Init1794327166580)
   import { defineMigration } from "@decohere/data";

   export default defineMigration({
   	id: "20261110-161246-init",
   	async up({ sql }) {
   		await sql(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
   		await sql(`CREATE TYPE "public"."account_role_enum" AS ENUM('admin', 'member')`);
   		await sql(`CREATE TABLE "account" (…)`);
   		// …the rest of its up, each queryRunner.query(…) as sql(…)
   	},
   	async down({ sql }) {
   		// its down, the same way
   	},
   });
   ```

   - `queryRunner.query(text, params)` becomes `sql(text, params)`. A migration that calls other `QueryRunner` methods (`createTable`, `addColumn`) needs the SQL they run: run the old migrations once with `logging: true` on a scratch database and copy it.
   - TypeORM's CLI creates the `uuid-ossp` extension before it migrates when an entity has a generated `uuid` key. Decohere runs only what a migration says, so put `create extension if not exists "uuid-ossp"` at the top of the first one.
   - Keep the TypeORM name in a comment: step 4 matches it to the database's history.

   List them in `src/migrations/index.ts`, in the same form `db new` writes (`db new` and `db generate` rewrite it from the folder from then on):

   ```ts
   import type { Migration } from "@decohere/data";
   import m20261110_161246_init from "./20261110-161246-init.js";
   import m20261110_170000_display_names from "./20261110-170000-display-names.js";

   export const migrations: Migration[] = [m20261110_161246_init, m20261110_170000_display_names];
   ```

   With many migrations, you can replace them with one instead: on an empty database, `pnpm decohere db generate baseline` writes the whole schema from the mappings. It holds tables, indexes and keys only, so add the rows and extensions the old migrations created by hand.

3. **Check it on an empty database.** `pnpm decohere db migrate` should build the schema the old migrations built. Compare the two with `pg_dump --schema-only`, leaving out the history tables (`-T migrations -T migrations_id_seq -T decohere_migrations`), and `pnpm decohere db generate check` should say the tables already match the mappings.

4. **Record what each existing database has**, once per environment, before the first deploy that runs `db migrate`. Find the last migration it applied, and the converted id that matches it:

   ```sql
   select name from migrations order by id desc limit 1;   -- DisplayNames1794330000000
   ```

   ```bash
   pnpm decohere db baseline 20261110-170000-display-names --dry-run
   # would record 20261110-161246-init
   # would record 20261110-170000-display-names
   pnpm decohere db baseline 20261110-170000-display-names
   pnpm decohere db status    # both applied, nothing pending
   pnpm decohere db migrate   # Nothing to apply
   ```

   In a packaged app it's `node es6/src/db.js baseline <id>`, with the migrate role's password in the environment, like `migrate`. `baseline` runs nothing: it records that migration and every one before it as applied. A database ahead of another (staging with a migration production hasn't had yet) gets its own last id, and `db migrate` applies the rest. If `db migrate` runs on a database before its baseline, its first migration fails on a type or table that already exists and is rolled back, so nothing changes: run `baseline`, then `migrate` again.

5. **Remove TypeORM's CLI**: the scripts, the `DataSource` file they load with its `migrations` and `migrationsRun` options, and the `tsx` dev dependency if nothing else uses it.

   | TypeORM script | Decohere |
   | --- | --- |
   | `migration:run` | `pnpm decohere db migrate` |
   | `migration:revert` | `pnpm decohere db revert` |
   | `migration:generate <path>` | `pnpm decohere db generate <name>` |
   | `migration:create <path>` | `pnpm decohere db new <name>` |
   | `migration:show` | `pnpm decohere db status` |

   TypeORM's `migrations` table stays until you drop it. Once every environment has its baseline, a migration with `drop table "migrations"` removes it.
