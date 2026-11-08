# 0024. Data keeps its own contracts, with MikroORM and TypeORM providers under them

- **Status:** Accepted
- **Date:** 2026-11-07 · updated 2026-11-08

## Context

`@decohere/data` defines the contracts: `IUnitOfWork` (`beginTransaction`, `commit`, dispose), `IDataProvider` (`findById`, `save`, `delete`, `all`) and an abstract `Repository`, with no ORM import. `@decohere/data-typeorm` is the only provider, on TypeORM 0.3. What the contracts lack shows in apps:

- **Queries.** Past `findById` and `all` there is nothing, so `data-typeorm`'s `TypeOrmRepository.firstOrDefault(FindOneOptions)` hands out TypeORM's own options type, and the scaffolded auth feature calls it with them.
- **Keys.** `Entity` requires a single `id`. A child keyed by its parent and an owner can't be one.
- **The unit of work.** It begins and commits a transaction, nothing more. One app's repositories skip it altogether: each method opens its own `db.transaction(…)`, so two calls in one request don't commit together.
- **Migrations.** There is no contract. Apps hand-write a second `DataSource` to run TypeORM's migrator.

Two spikes tested what to build:

1. One `Order` aggregate on TypeORM 1.1.2, MikroORM 7.2.8 and Drizzle 1.0.0-rc.5: repository, unit of work, generated schema migration, data backfill, `flux serve` reboots, deliberate query typos. All three passed. Drizzle was then set aside: it has no unit of work, and its 1.0 isn't final.
2. A real repository: a private app's `SigningRepository`, with a proposal aggregate whose signatures are its children, versioned signer changes and row locks. It was ported to MikroORM, and its own contract tests pass unchanged on the shipped TypeORM version and on the port (7 of 7 each). Then a proposal repository was written **once** against the contract additions below and run on both providers. The same contract cases pass (3 of 3 each), and so do eight unit-of-work scenarios, with the SQL each provider sent captured.

### The unit of work, side by side

Both providers met the same contract and sent almost the same SQL:

| Scenario | TypeORM provider (tracking in `data`) | MikroORM provider |
|---|---|---|
| Change one field of a loaded aggregate, no save call | One `UPDATE … SET note, version = version + 1 WHERE id AND version` | The same, with `RETURNING version` |
| The same row loaded twice | One `SELECT`, same instance | One `SELECT`, same instance |
| Two new aggregates (3 children) plus a child on a third, one commit | One multi-row `INSERT` per table, parents first | The same; MikroORM also flushes before a query that might see the new rows |
| A child removed, another added | `INSERT` and `DELETE` of the child rows only | The same |
| Disposed without commit; a commit that fails part-way | `ROLLBACK`; nothing kept | `ROLLBACK`; nothing kept |
| Two units change the same row | The second `UPDATE` matches nothing: `OptimisticLockError` | The same |
| Domain events | Raised by the aggregate, written to an outbox table in the same commit, by the unit of work in `data` | The same hook, before MikroORM's flush |
| Concurrent requests through crucible | One unit of work per request scope, separate identity maps, the failed request rolled back | The same |

TypeORM by itself keeps no identity map and tracks no changes, which is why that app's repositories write each change by hand in targeted SQL. A unit of work doesn't remove that need for "insert if absent": `ON CONFLICT DO NOTHING` stays, in both providers.

### Migrations, side by side

| | TypeORM migrator | MikroORM migrator | One Decohere format (prototype) |
|---|---|---|---|
| Generated from a model change | Yes, but only through the CLI and a second `DataSource` file (or the schema builder in code) | Yes, as a TypeScript class with `up` and `down` | Yes, from either ORM's diff, as a Decohere file |
| Data migration with the app's services, batched | Yes, via a class built in a closure | Yes, the same way; raw rows return `timestamptz` as a string | Yes: `up({ sql, container, batch })` |
| Up, down, up | Works | Works | Works |
| History | A `migrations` table | A `mikro_orm_migrations` table | One `decohere_migrations` table, the same with either ORM |
| Two instances starting at once | **No lock**: the backfill ran twice | **No lock**: the backfill ran twice | An advisory lock: the second instance waits, then has nothing to do |
| Runs under flux; ships with `forge package` | Yes, when listed in code | Yes, when listed in code | Yes, listed in code. Forge warns on a directory scan it can't follow |
| Diff in a shared database | Ignores tables it doesn't map | Proposes dropping **every** table and schema it can see but doesn't map; `skipTables` matches bare table names only, so it can't tell two apps' `proposal` tables apart | As the ORM generating it |

Running as the superuser, MikroORM's generated initial migration dropped five other schemas in the spike's database. Generated as the data source's own migrate role, which the bootstrap ([0011](0011-database-bootstrap.md)) already grants only its own schema, the same diff held just its own changes. MikroORM's initial migration also starts with `create schema`, which that role may not run, and some of its index renames name no schema.

A migration history can change provider: the prototype applied a migration generated from the TypeORM mapping, then one generated from the MikroORM mapping, on the same database. The cost was one migration's worth of renames, from TypeORM's hashed index and key names to MikroORM's.

## Decision


1. **`@decohere/data` owns the contracts; ORMs are providers.** `data-typeorm` stays, and a `data-mikro-orm` provider is added beside it.
2. **The unit of work promises change tracking**, not explicit saves: an identity map, changes to anything loaded written on `commit` and nothing before it, one transaction, rollback on dispose, a version column checked on update, and an outbox for events the aggregates raise. Removing an aggregate deletes the children it loaded; children it didn't load are the database's to cascade, as with MikroORM, so a remove never loads more rows.
3. **MikroORM's unit of work is the reference; Decohere's tracker matches it.** The MikroORM provider uses MikroORM's own unit of work. The TypeORM provider uses a tracker that lives once in `data` (`TrackingUnitOfWork`), modelled on MikroORM's and written from scratch, so no MikroORM code or licence notice comes with it. A provider under the tracker supplies the mapping, transaction control and four operations on plain rows (select, insert, update, delete). The tracker builds the objects itself, so no ORM loads relations or keys under it.

   **One contract suite holds the two together.** It runs every case against both providers, checking behaviour (instances, rows, errors) and the writes sent: statements, their order, tables, rows, the columns each update sets, and reads that lock. Plain reads aren't compared, because MikroORM may join children into one SELECT and reads a new version back after a commit, where the tracker already knows it. MikroORM is the oracle: its writes are snapshotted, so a MikroORM upgrade that changes them fails the suite until the tracker follows, or until the difference is written into the suite with its reason. The suite covers the scenarios above, plus children nested two deep, a child moved between parents, a key made of a reference and a column, foreign-key cycles, keys the database generates, and deletes.
4. **Queries go through a Decohere `Query<T>`**: `where` with `in`, `gt`, `gte`, `lt`, `lte`, `ne` and null, plus `orderBy`, `limit`, `include` for children, and `lock`. Each provider translates it in about ten lines. `firstOrDefault(FindOneOptions)` goes. Keys may be composite, so `Entity`'s single `id` goes too.
5. **Children are a `Children<T>`** (`add`, `remove`, iteration, `length`). MikroORM's `Collection` meets it, and the TypeORM provider loads arrays into a `ChildList`. Records keep their persistence apart from the domain: each provider maps the same classes in its own mapping file, and the domain imports neither ORM.
6. **One Decohere migration format**, in `data`, and one runner per database, in its package (`postgres.migrator` in `data-postgres`, on a plain `pg` connection). A migration is `defineMigration({ id, up, down })` with the app's container and a batch helper, listed in its folder's generated `index.ts`. The runner keeps one `decohere_migrations` history table in the data source's schema, holds an advisory lock and runs a transaction per migration, as the migrate role. A provider is given the database's package as `database: postgres` (bootstrap and migrator together) and its `migrations`, and supplies only the schema diff (TypeORM's schema builder, MikroORM's schema generator), taken as the migrate role, leaving the history table and schemas alone.

   **The commands run from the app**, not from the Decohere CLI: an app's `db.ts` builds the app (`createApp()`) without starting it and calls `db.run(app, argv)` for `migrate`, `status`, `revert`, `new` and `generate`. A packaged app then runs `db migrate` as a release step with nothing but its own dependencies. Building an app changes nothing in its database: `migrateOnStart` (development only), `synchronize` and seed run as start steps ([ADR 0010](0010-hosted-services.md)).
7. **MikroORM is the default** for new apps. TypeORM moves to 1.x.

Rejected:

- **The runner in `data`.** It needs Postgres SQL (the advisory lock, `to_regclass`) and `pg`, and every Postgres-only piece lives in `data-postgres` ([ADR 0011](0011-database-bootstrap.md)).
- **`decohere db` in the CLI, loading the app.** The CLI is a development tool and isn't in a packaged app, and loading an app from outside needs a convention for finding and building it. A thin `decohere db` that runs the app's `db.ts` can come later.
- **Each ORM's own migrator behind a common CLI.** Neither migrator locks, so two instances run the same migration twice. Each keeps its own history table, so changing provider means migrating the history, and TypeORM's needs the second config file this design removes.
- **Explicit `save` in the contract.** MikroORM's tracking would go partly unused, and the TypeORM provider would still need the snapshot to write only what changed.
- **Drizzle as a provider now.** Decohere would supply its unit of work and migrator anyway; it could become a third provider later through the same row store.

## Consequences

- Keeping the providers in step is a test, not a review: the contract suite runs in CI for both, and a MikroORM upgrade lands only with the suite passing on both or a recorded difference.
- The size of what Decohere builds, formatted, without blanks or comments: contracts about 125 lines, the tracker 541 and its row-store interface 45, the TypeORM row store 268, the MikroORM unit of work 137. The spike's tracker was 200 compact lines; the built one adds cycles, inserts in waves for generated keys, moved children, references held by key, and collections that fail when not loaded. The migration runner is 197, the commands 143 and the file writer 76; the spike's runner was 84 lines with no status, dry run or checks.
- A repository written against the contract runs on both providers: the proposal repository is 59 lines, with no ORM import. Mappings are per provider (27 lines each for the proposal aggregate), so changing provider means rewriting the mappings and one rename migration, not the repositories or the history.
- The lowest common denominator shows: `Query<T>` covers filters, order, limit, children and locks, not joins across aggregates or aggregates in SQL. Those go through each provider's escape hatch (MikroORM's `em.getKysely()`, TypeORM's query builder), behind the repository.
- MikroORM changes the classes it maps at run time (`toJSON`, field accessors, `__helper`), and a loaded child carries its parent. HTTP responses should map to DTOs, not serialise records. Those accessors stay on the class, so one class can't be mapped by two providers in one process: the contract suite builds its model once per provider.
- MikroORM leaves a version column to the database's default on insert, so version columns need one.
- TypeORM 0.3 ignored `primary: true` on a many-to-one in an `EntitySchema`, silently making the wrong primary key. TypeORM 1.x makes the right one, and the row store writes plain rows, so no extra key column is needed.
- Child collections in a TypeORM mapping are one-to-many with `persistence: false`. TypeORM refuses a class that starts one as a `ChildList` otherwise, and the tracker writes them.
- Migrations name their schema in the SQL, so one file set serves one schema. The runner also sets `search_path` to it, since some of MikroORM's statements (index renames) name none.
- MikroORM's diff opens with `create schema` and its reverse with `drop schema`; both are left out, as schemas are the bootstrap's.
- A data migration's services write through their own connections, outside the migration's transaction. Only `sql` is inside it.
- Resumable checkpoints for long data migrations, and a helper to test a migration against a throwaway database, are later steps.
- Existing apps move their repositories onto the unit of work and their migrations into the Decohere format, one repository at a time. Follow-up issues cover each piece once this record is accepted.

## History

- 2026-11-07: Proposed after a spike on TypeORM 1.1.2, MikroORM 7.2.8 and Drizzle 1.0.0-rc.5. Revised the same day after porting a real repository and comparing the unit of work and migrations on TypeORM 0.3.31 and MikroORM 7.2.8: both providers stay under data's contracts, instead of TypeORM being removed.
- 2026-11-07: Accepted. MikroORM's unit of work is the reference the TypeORM provider's tracker follows, held together by one contract suite.
- 2026-11-08: Built the contracts, the tracker, the TypeORM 1.x provider and the MikroORM unit of work. Following MikroORM, a remove deletes only the children it loaded. The tracker takes plain rows, so it needs four row operations, not five. The suite compares writes and locking reads, not plain reads, and the sizes are the built code's.
- 2026-11-08: Built the migrations. The runner went to `data-postgres` rather than `data`, providers take `database: postgres` in place of `bootstrap`, and the commands run from the app's `db.ts` rather than the Decohere CLI.
- 2026-11-08: The scaffold generates MikroORM apps by default (`--database postgres/mikro-orm`; `postgres/typeorm` stays), each with `app.ts`, `main.ts` and `db.ts`, its first migrations, and `pnpm db` scripts in place of TypeORM's CLI.
