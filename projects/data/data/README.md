# @decohere/data

The data contracts a Decohere app's repositories are written against, with no ORM in them. A provider package puts an ORM under them: [`@decohere/data-mikro-orm`](../data-mikro-orm/README.md) or [`@decohere/data-typeorm`](../data-typeorm/README.md). For tests and local runs with no database, [`@decohere/data-memory`](../data-memory/README.md) holds the rows in the process. Why it's built this way: [ADR 0024](../../../docs/contributing/adr/0024-default-orm.md).

## The unit of work

Each request gets one `IUnitOfWork`, injected with `@injectUnitOfWork()`. It promises the same on every provider:

- **An identity map.** A row loaded twice in one unit of work is the same object. `findById` answers from it without asking the database, and finds an entity given to `add` and not yet committed, with its children as they are, so "find it, or add it" works within one unit of work. Queries (`find`, `findOne`) see only the database: an added entity is in their answers once committed. MikroORM behaves the same.
- **Change tracking.** Change anything it loaded, then `commit()`: it writes only the fields that changed, with no save call. `add(entity)` inserts a new one and its children; `remove(entity)` deletes one and the children it loaded. It never loads more rows to delete them: declare `ON DELETE CASCADE` on a child's foreign key when its parent may be removed without loading it.
- **One transaction.** A commit writes every change in one transaction, parents before children, children deleted before their parents. Rows that reference each other are inserted with the nullable reference empty, then updated.
- **Version checks.** When the mapping has a version field, an update matches only the version it loaded, and a lost race throws `OptimisticLockError`.
- **An outbox.** With an `outbox` mapper configured, events an aggregate raises (`RaisesEvents.pullEvents()`) are written in the same commit.
- **Nothing before commit**, but for `addIfAbsent` and a repository's own SQL, which write at once in the unit of work's transaction. Reads never write pending changes. Disposing without a commit rolls back. After a failed commit the unit of work is rolled back and refuses further use: start a new one.

```ts
const order = await uow.findById(Order, id, ["lines"]);
order.lines.add(new Line("apple", 2));
order.note = "gift";
await uow.commit(); // INSERT line, UPDATE orders SET note, version
```

### Add unless it's already kept

`addIfAbsent(entity)` inserts a new entity unless a row with its key is already kept, and answers whether it was new. It's for append-only records, such as a ledger's entries or a receipt, written once under a key the caller chose:

```ts
if (await uow.addIfAbsent(new Receipt(paymentId, amount))) {
	// new: this request is the one that records it
}
await uow.commit();
```

It answers now, so it writes now: `INSERT … ON CONFLICT DO NOTHING RETURNING …` on MikroORM and TypeORM, a key check on memory. The insert runs in the unit of work's transaction, which it begins if none is open, so it commits with the rest of the unit of work, or rolls back with it. It takes a whole aggregate: the root's row is written at once, and its children, nested ones included, on commit with the rest of the unit of work. After `true` the entity is managed, as if loaded: its generated key and version are set, and its children and later changes to it are saved on commit. After `false` the entity isn't attached: nothing of it is written, children included, and the rest of the unit of work commits as usual. Load the kept row with `findById` to see it.

What it can't do, since it writes before the rest of the commit:

- **An entity it references must already be in the database**, not just given to `add` in the same unit of work: the foreign key is checked when it writes, and fails the statement (and so the transaction).
- **It takes a new entity.** One the unit of work already loaded or was given to `add` is refused.
- **"Already kept" means any unique key**, on the SQL providers: `ON CONFLICT DO NOTHING` skips a row that clashes with any unique constraint, not only the primary key. Memory knows only the key.
- **It waits for a row another transaction is inserting under the same key**, as Postgres does, and answers once that transaction ends.

## Queries

`find`, `findOne` and `findById` take a `Query<T>` in Decohere's terms, checked by the compiler against the entity's own fields:

```ts
await uow.find(Order, {
	where: { status: "open", placedAt: { lt: cutoff }, note: null, customer: { in: names } },
	orderBy: { placedAt: "desc" },
	limit: 50,
	include: ["lines", "lines.parts"], // child collections, nested up to three deep
	load: ["terms"], // fields loaded only on request
	lock: "update", // SELECT … FOR UPDATE, in a transaction it opens
});
```

Operators: a bare value or `null` (equal), `in`, `ne`, `gt`, `gte`, `lt`, `lte`. A reference compares with an entity or its key. For what a query can't express (joins across aggregates, aggregates in SQL), a repository runs its own SQL in the unit of work's transaction.

`findById` takes the same `include` and `load` as options, `findById(Order, id, { include: ["lines"], load: ["terms"] })`, or the child collections alone as an array, `findById(Order, id, ["lines"])`.

### Fields loaded only on request

A large field, such as a JSON document, can be mapped as loaded only on request: TypeORM's `select: false`, MikroORM's `.lazy()`, or `lazy` in a memory mapping. A query leaves its column out unless it names the field in `load`, and the entities it returns have the field `undefined`:

```ts
const all = await algos.find(); // SELECT without "document"; each algo.document is undefined
const one = await algos.findById(id, { load: ["document"] });
```

- **Saving leaves an unloaded field alone.** An aggregate loaded without it can change, and the commit writes only what changed: the column keeps its value. Assigning the field without loading it is a change like any other: the commit writes the new value, on every provider.
- **Asking for it later loads it into the same instance.** A `findById` whose instance is in the identity map without the field reads it from the database, and so does a `find` that names it in `load`. Once loaded, `findById` answers from the identity map again.
- `load` takes the entity's fields, checked by the compiler. Naming one the mapping always loads does nothing more.

## A repository's own SQL

A statement `Query<T>` can't express runs in a provider-side repository, on the unit of work's own connection and inside its transaction. Each provider's unit of work has a `transaction()` method that opens the transaction if none is open yet, as a locking `find` does, and returns the provider's own handle: the entity manager on [MikroORM](../data-mikro-orm/README.md#a-repositorys-own-sql), the row store and its query runner on [TypeORM](../data-typeorm/README.md#a-repositorys-own-sql). A statement run through it:

- runs at once, not at commit;
- commits with the unit of work, or rolls back with it when the commit fails or the unit of work is disposed without one;
- sees what the unit of work has written in that transaction, such as rows `addIfAbsent` or an earlier statement wrote. Changes the unit of work hasn't written yet (everything waiting for `commit()`) aren't in the database, so a statement doesn't see them;
- bypasses the identity map and change tracking. Rows it writes or reads aren't entities the unit of work tracks: load them with `findById` or `find` to change them.

`IUnitOfWork` itself has no such method: SQL is written for one provider's API and dialect, and the memory provider has none. A repository that needs it is written per provider, injecting that provider's unit of work type.

## Aggregates and children

An aggregate's children are a `Children<T>` (`add`, `remove`, iteration, `length`). A new aggregate starts with a `ChildList`; a loaded one holds whatever its provider loads (MikroORM's `Collection`, or a `ChildList`). A collection that wasn't included throws when used, rather than looking empty. Moving a child to another parent's collection updates its reference; dropping it from every collection deletes it.

Domain classes import no ORM. Each provider maps them in its own files. Loading creates instances without calling their constructors, so initialise lazily what isn't mapped (`this.events ??= []`).

## Repositories

```ts
@injectable()
export class OrderRepository extends Repository<Order> {
	public constructor(@injectUnitOfWork() unitOfWork: IUnitOfWork) {
		super(unitOfWork, Order);
	}

	public open() {
		return this.find({ where: { status: "open" }, include: ["lines"] });
	}
}
```

`Repository<T>` gives `findById`, `find`, `findOne`, `add`, `addIfAbsent` and `remove`. The service that finishes the work commits the unit of work.

## Setting up the database

A provider is given the package for its database as `database`: `postgres` from [`@decohere/data-postgres`](../data-postgres/README.md), which supplies a bootstrap and a migrator.

When the app is **built**, a provider runs `dataSources.check`: each data source's `auth`, `synchronize` and `migrateOnStart` for the environment ([ADR 0011](../../../docs/contributing/adr/0011-database-bootstrap.md)). A data source that asks to be set up (`bootstrap: true`, or an admin user in development) when the provider has no `database` stops the build with an error that says what to install. Building connects to nothing.

When the app **starts**, before hosted services and the server, the provider's start step runs `dataSources.open`: the bootstrap, which creates the database, roles and schema, then a connection per data source. Then each data source applies pending migrations if `migrateOnStart` is on, brings its tables to the mappings if `synchronize` is on, and then seeds if `seed` is on. An app that is only built, by a tool or a test, changes nothing in the database. `migrateOnStart` and `synchronize` are for development, and can't both be on.

**A database that is down at start doesn't stop the app.** The start step is retried with backoff ([`startRetry`](../../core/README.md#app)), and the hosted services wait for it. Meanwhile `GET /ready` answers 503, and a request that resolves the data source's unit of work gets `DependencyUnavailableError`, a 503 problem. Once the database answers, the step bootstraps, connects and migrates, and the app serves. `startTestApp` and `startRetry: false` fail the start instead.

## Migrations

A migration is a TypeScript file in the data source's migrations folder, listed in that folder's generated `index.ts` and passed to the provider (`mikroOrm({ …, database: postgres, migrations })`). Nothing is globbed at run time, so `flux` runs them from source and `forge package` ships them.

```ts
// src/migrations/20261110-093000-backfill-expiry.ts
export default defineMigration({
	id: "20261110-093000-backfill-expiry",
	async up({ sql, container, batch }) {
		const policy = container.resolve(ExpiryPolicy);
		await batch(`select id, placed_at from orders where expires_at is null order by id limit $1`, 500, async (rows) => {
			for (const r of rows) await sql(`update orders set expires_at = $1 where id = $2`, [policy.expiresAt(r.placed_at), r.id]);
		});
	},
	async down({ sql }) {
		await sql(`update orders set expires_at = null`);
	},
});
```

Each migration runs in its own transaction, as the data source's migrate role, in its schema. The history is one `decohere_migrations` table in that schema, whichever provider maps the entities. A lock keeps two runs from applying the same migration.

The commands run from the app's own `db.ts`, which builds the app without starting it. Every command but `new` first bootstraps and connects the data source, which starting would otherwise do, so `db migrate` works against a database nothing has set up yet. In a workspace, `decohere db <command> [--api <name>]` finds and runs it; in a packaged app, `node es6/src/db.js <command>`.

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

| Command | Does |
| --- | --- |
| `migrate [--to <id>] [--dry-run]` | Applies pending migrations in id order |
| `baseline <id> [--dry-run]` | Records the migrations up to `<id>` as applied without running them, for a database another tool already migrated |
| `status` | Lists migrations: applied, pending, or in the history but not the code |
| `revert` | Undoes the last applied migration |
| `new <name> [--data]` | Writes an empty migration; with `--data`, one that changes rows and fails until written |
| `generate <name>` | Writes a schema migration from the provider's diff of the mappings against the tables |

`generate` connects as the migrate role, which sees only its own schema, so the diff can't touch another app's tables. It refuses while migrations are pending, since the diff would repeat them. With several data sources, name one with `--data-source`. How to run them in development and in a deploy, and how to change a schema without downtime: [Migrations](../../../docs/guide/recipes/migrations.md). An app on TypeORM's own migrations moves over with [Move from TypeORM's migrations](../../../docs/guide/recipes/migrations.md#move-from-typeorms-migrations).

## Working on this package

For contributors to Decohere: how the package is laid out and tested. Using it needs nothing below.

`data` is the base package: it holds the contracts (`IUnitOfWork`, `Repository<T>`, `RowStore`, `Migrator`, `MigrationTarget`, the `Query<T>` types) and installs no ORM. `data-mikro-orm`, `data-typeorm` and `data-memory` implement them, and `data-postgres` sets up the database. Folders in `src/`:

- the top level: the unit of work contract and `@injectUnitOfWork()`, `Repository`, queries, children, domain events, the `database` config section, and `dataSources` (`check`, `open`, `resolve`, `start`, a namespace object today) with the policy each data source follows;
- `tracking/`: `TrackingUnitOfWork`, the `RowStore` contract it writes through, and the `EntityMapping` contract, a provider's mapping read as `EntityModel`s for another provider to take;
- `migrations/`: migrations, the `Migrator` contract, migration files, `MigrationTarget`, and the db commands (`db.run`, a namespace object today, behind `DbCommandError`).

The canonical suite is the unit-of-work contract, the cases in `tests/contract/cases.ts`: on the SQL providers in `tests/unit-of-work.contract.docker.spec.ts`, against Postgres, with MikroORM's writes snapshotted as the reference, and on the memory provider in `tests/unit-of-work.contract.spec.ts`, on its own mapping and on each ORM's. Units cover the query types (`tests/query.types.spec.ts`) and configuration checks (`tests/data-sources.spec.ts`) ([testing](../../../docs/contributing/testing/README.md#canonical-suite-ownership)). Specs are in `tests/` today and move beside the code ([ADR 0027](../../../docs/contributing/adr/0027-code-design.md)).

### Writing a provider

A provider plugin pairs its modules with the config's data sources through `dataSources.resolve`, runs `dataSources.check` with the bootstrap from the `database` its caller passed, registers its data sources unconnected, and registers a start step that runs `dataSources.open` and then `dataSources.start` for each. Until that step has connected a data source, resolving its unit of work throws `DependencyUnavailableError`. For each data source given a `database`, it registers a `MigrationTarget` under `MigrationTargetToken`: the migration source, the migrator, `open()` (the same `dataSources.open`, for the db commands, which never start the app), and its ORM's schema diff, taken as the migrate role. Its unit of work either wraps an ORM's own unit of work (as `data-mikro-orm` does) or uses `TrackingUnitOfWork`, which does the tracking itself over a `RowStore`: the mapping as an `EntityModel`, the transaction, and five row operations (`select`, `insert`, `insertIfAbsent`, `update`, `delete`) on plain rows. A field in the model's `lazy` is selected only when the row query names it in `load`; a row leaves out the ones it didn't select. A provider whose ORM maps the classes also implements `EntityMapping`, reading that mapping as `EntityModel`s without connecting (with `onDelete` and `generated` where the mapping says so), so the memory provider can run on it (`TypeOrmMapping`, `MikroOrmMapping`).

MikroORM's unit of work is the reference. The cases are in `tests/contract/cases.ts`. `tests/unit-of-work.contract.docker.spec.ts` runs every case on both SQL providers against Postgres. It snapshots the writes MikroORM sends and checks the tracker sends the same writes. The comparison covers statements, order, tables, rows, the columns each update sets, and locking reads. Plain reads aren't compared, because the providers may batch them differently. It also checks each case's outcome. `tests/unit-of-work.contract.spec.ts` runs the same cases on the memory provider, in `pnpm test`, checking outcomes only, since it sends no SQL: once on memory's own mapping, and once on each ORM's mapping of the same model, through `TypeOrmMapping` and `MikroOrmMapping`. The cases in `sqlCases` run SQL of their own, through the provider's `transaction()`, so it runs on the SQL providers only.

### Upgrading MikroORM

1. Bump `@mikro-orm/*` in the root `package.json` and install.
2. Run `pnpm test:docker projects/data/data/tests/unit-of-work.contract.docker.spec.ts`.
3. If a snapshot changed, MikroORM's behaviour changed. Either make the tracker follow it, so both providers pass with the new snapshot (`-u`), or keep the old behaviour and record the difference in that case, with the reason.
