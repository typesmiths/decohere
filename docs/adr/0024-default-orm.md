# 0024. Data keeps its own contracts, with MikroORM and TypeORM providers under them

- **Status:** Proposed
- **Date:** 2026-11-07

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

Proposed; the owner chooses each point.

1. **`@decohere/data` owns the contracts; ORMs are providers.** `data-typeorm` stays, and a `data-mikro-orm` provider is added beside it.
2. **The unit of work promises change tracking**, not explicit saves: an identity map, changes to anything loaded written on `commit`, one transaction, rollback on dispose, a version column checked on update, and an outbox for events the aggregates raise.
3. **The tracking lives once, in `data`** (`TrackingUnitOfWork`), for providers without their own, as TypeORM is. It is modelled on MikroORM's unit of work and written from scratch, so no MikroORM code or licence notice comes with it. A provider supplies metadata, transaction control and five row operations (select, select children, insert, update, delete). The MikroORM provider uses MikroORM's own unit of work.
4. **Queries go through a Decohere `Query<T>`**: `where` with `in`, `gt`, `gte`, `lt`, `lte`, `ne` and null, plus `orderBy`, `limit`, `include` for children, and `lock`. Each provider translates it in about ten lines. `firstOrDefault(FindOneOptions)` goes. Keys may be composite, so `Entity`'s single `id` goes too.
5. **Children are a `Children<T>`** (`add`, `remove`, iteration, `length`). MikroORM's `Collection` meets it, and the TypeORM provider loads arrays into a `ChildList`. Records keep their persistence apart from the domain: each provider maps the same classes in its own mapping file, and the domain imports neither ORM.
6. **One Decohere migration format and runner**, in `data`, on a plain Postgres connection: `defineMigration({ id, up, down })`, one history table, an advisory lock, a transaction per migration, the app's container and a batch helper. Providers supply only the schema diff (TypeORM's schema builder, MikroORM's schema generator). `decohere db generate` connects as the data source's migrate role, and leaves Decohere's history table alone.
7. **MikroORM is the default** for new apps. TypeORM moves to 1.x.

Rejected:

- **Each ORM's own migrator behind a common CLI.** Neither migrator locks, so two instances run the same migration twice. Each keeps its own history table, so changing provider means migrating the history, and TypeORM's needs the second config file this design removes.
- **Explicit `save` in the contract.** MikroORM's tracking would go partly unused, and the TypeORM provider would still need the snapshot to write only what changed.
- **Drizzle as a provider now.** Decohere would supply its unit of work and migrator anyway; it could become a third provider later through the same row store.

## Consequences

- The size of what Decohere builds, without blanks or comments: contracts 36 lines, the tracker 200, the TypeORM row store 102, the MikroORM provider 59, the migration runner 84 and the diff and file writer 44. Each still needs tests at production quality.
- A repository written against the contract runs on both providers: the proposal repository is 59 lines, with no ORM import. Mappings are per provider (27 lines each for the proposal aggregate), so changing provider means rewriting the mappings and one rename migration, not the repositories or the history.
- The lowest common denominator shows: `Query<T>` covers filters, order, limit, children and locks, not joins across aggregates or aggregates in SQL. Those go through each provider's escape hatch (MikroORM's `em.getKysely()`, TypeORM's query builder), behind the repository.
- MikroORM changes the classes it maps at run time (`toJSON`, field accessors, `__helper`), and a loaded child carries its parent. HTTP responses should map to DTOs, not serialise records.
- TypeORM 0.3 ignores `primary: true` on a many-to-one in an `EntitySchema`, silently making the wrong primary key. The TypeORM mapping declares the key column as well, and the row store fills it from the reference.
- Migrations name their schema in the SQL, so one file set serves one schema.
- Existing apps move their repositories onto the unit of work and their migrations into the Decohere format, one repository at a time. Follow-up issues cover each piece once this record is accepted.

## History

- 2026-11-07: Proposed after a spike on TypeORM 1.1.2, MikroORM 7.2.8 and Drizzle 1.0.0-rc.5. Revised the same day after porting a real repository and comparing the unit of work and migrations on TypeORM 0.3.31 and MikroORM 7.2.8: both providers stay under data's contracts, instead of TypeORM being removed.
