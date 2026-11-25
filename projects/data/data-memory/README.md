# @decohere/data-memory

The in-memory provider for [`@decohere/data`](../data/README.md): the same repositories and unit of work as on a database, with the rows held in the process. For tests and local runs that shouldn't need Postgres. The unit of work is data's `TrackingUnitOfWork`, as on [TypeORM](../data-typeorm/README.md), over a `MemoryRowStore`. The contract suite's cases run on it in `pnpm test`, with no Docker.

```ts
builder.use(
	memory({
		entities: [
			mapEntity(Order, {
				fields: ["customer", "note", "status", "placedAt"],
				version: "version",
				children: [{ prop: "lines", target: Line, parentRef: "order" }],
			}),
			mapEntity(Line, {
				fields: ["sku", "quantity"],
				references: [{ prop: "order", target: Order }],
			}),
		],
		repositories: [OrderRepository],
		outbox: toOutboxMessage,
		seed: async (uow) => uow.add(new Order("demo")),
	}),
);
```

Swapping it for `typeOrm(…)` or `mikroOrm(…)` changes this line, not the repositories. If the classes are already mapped for one of them, memory takes that mapping ([below](#taking-an-orms-mapping)), so the swap changes nothing else. It needs no `database` config, connects to nothing and has nothing to migrate, so the `db` commands find no data source on it. Each build of the app starts with empty stores, so two apps, or two tests, never share rows. With `seed`, the app's start step adds the rows, in a unit of work committed when it returns.

## Taking an ORM's mapping

An app that also runs on a database maps its classes once, for its ORM, and gives memory that mapping:

```ts
import { TypeOrmMapping } from "@decohere/data-typeorm";

builder.use(
	memory({
		entities: new TypeOrmMapping([Order, Line]),
		repositories: [OrderRepository],
	}),
);
```

`TypeOrmMapping` takes what `typeOrm()` takes as `entities`: classes with TypeORM's decorators, or `EntitySchema`s. `new MikroOrmMapping([OrderSchema, LineSchema])`, from `@decohere/data-mikro-orm`, takes what `mikroOrm()` takes. Each reads its ORM's mapping when the app is built, without connecting, so the keys, references, children, version and generated key are the ones the ORM has, and a change to the mapping needs no second edit. It is checked as `mapEntity`'s is, below.

What memory keeps from a mapping is what it keeps from a database: a reference that deletes with the row it references is one mapped with `onDelete: "CASCADE"` (TypeORM) or `.deleteRule("cascade")` (MikroORM). A database's `on delete cascade` that the mapping doesn't say isn't seen here. Many-to-many relations and embedded columns aren't supported.

## Mapping

For classes no ORM maps, each one is mapped with `mapEntity(type, options)`:

| Option | Means |
| --- | --- |
| `key` | The properties making the key: fields or references. Defaults to `["id"]`. |
| `fields` | The properties stored as values. Key fields, the version and the generated key may be left out. |
| `references` | `{ prop, target, nullable?, onDelete? }`: a property holding another mapped entity, stored as its key. Required unless `nullable`. `onDelete: "cascade"` deletes this row with the one it references. Otherwise that delete fails while this row references it. |
| `children` | `{ prop, target, parentRef, orderBy? }`: a `Children<T>` collection, the rows of `target` whose `parentRef` references this one. |
| `version` | A number checked and incremented on every update. |
| `generated` | A key field numbered 1, 2, 3… when an insert leaves it empty, like a serial column. |
| `lazy` | Fields loaded only when a query names them in `load`, like TypeORM's `select: false` ([data](../data/README.md#fields-loaded-only-on-request)). Each is one of `fields`, and not the key or the version. |

The mapping is checked when the app is built, so a reference to a class that isn't mapped fails then.

## What it keeps from a database

It behaves as Postgres does wherever a repository could tell the difference:

- **Keys and foreign keys.** A second row with the same key fails, and `addIfAbsent` answers `false` for it. So does a reference to a row that doesn't exist, an empty required reference, or deleting a row that something still references (unless the reference cascades).
- **Transactions.** A unit of work's writes stay its own until it commits, and are applied all together. Reads see what is committed plus their own writes. A statement that fails aborts the transaction, which can then only roll back.
- **Row locks.** These take Postgres's modes: `lock: "update"` and deletes lock the row, updates lock it against other updates, and a reference locks the row it points at against deletion. A second unit of work waits for the first to commit or roll back, then reads the row as it is. Two that would wait for each other fail one of them with a deadlock error.
- **Copies.** Rows are copied in and out, so an object held outside the unit of work can't change what is stored.
- **SQL's nulls.** An empty value matches only `null` and `{ ne: … }` with a value given. It sorts last ascending and first descending.

What differs: strings compare and sort by code unit, not by the database's collation. Columns have no types, lengths or `NOT NULL` checks beyond the key and required references. The rows last only as long as the app. And there is no SQL: a repository that runs its own ([data](../data/README.md#a-repositorys-own-sql)) is written for a SQL provider and doesn't run here.

## Working on this package

For contributors to Decohere: how the package is laid out and tested. Using it needs nothing below.

`data-memory` implements data's `RowStore` in the process, under data's `TrackingUnitOfWork`. `src/` is flat: `memory.plugin.ts` (`memory(...)`), `memory-entity.ts` (`mapEntity`, the mapping), `memory.row-store.ts` (`MemoryRowStore`) and `memory.store.ts` (`MemoryStore` and its transactions: keys, locks and copies). A mapping is data's `EntityModel`; `entities` takes those, or data's `EntityMapping`, which the ORM providers implement. The plugin makes each store in a post-build step, since an `EntityMapping` is read asynchronously.

Its canonical suite is data's unit-of-work contract: the cases run on it in `projects/data/data/tests/unit-of-work.contract.spec.ts`, in `pnpm test`, once on its own mapping and once on each ORM's mapping of the same model ([testing](../../../docs/contributing/testing/README.md#canonical-suite-ownership)). Here, `tests/memory.store.spec.ts` covers the store's keys, locks and copies, and `tests/memory.plugin.spec.ts` the plugin. Specs are in `tests/` today and move beside the code ([ADR 0027](../../../docs/contributing/adr/0027-code-design.md)).
