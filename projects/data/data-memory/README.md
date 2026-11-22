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

Swapping it for `typeOrm(…)` or `mikroOrm(…)` changes this line and the mappings, not the repositories. It needs no `database` config, connects to nothing and has nothing to migrate, so the `db` commands find no data source on it. Each build of the app starts with empty stores, so two apps, or two tests, never share rows. With `seed`, the app's start step adds the rows, in a unit of work committed when it returns.

## Mapping

There's no ORM to read a mapping from, so each class is mapped with `mapEntity(type, options)`:

| Option | Means |
| --- | --- |
| `key` | The properties making the key: fields or references. Defaults to `["id"]`. |
| `fields` | The properties stored as values. Key fields, the version and the generated key may be left out. |
| `references` | `{ prop, target, nullable?, onDelete? }`: a property holding another mapped entity, stored as its key. Required unless `nullable`. `onDelete: "cascade"` deletes this row with the one it references. Otherwise that delete fails while this row references it. |
| `children` | `{ prop, target, parentRef, orderBy? }`: a `Children<T>` collection, the rows of `target` whose `parentRef` references this one. |
| `version` | A number checked and incremented on every update. |
| `generated` | A key field numbered 1, 2, 3… when an insert leaves it empty, like a serial column. |

The mapping is checked when the app is built, so a reference to a class that isn't mapped fails then.

## What it keeps from a database

It behaves as Postgres does wherever a repository could tell the difference:

- **Keys and foreign keys.** A second row with the same key fails. So does a reference to a row that doesn't exist, an empty required reference, or deleting a row that something still references (unless the reference cascades).
- **Transactions.** A unit of work's writes stay its own until it commits, and are applied all together. Reads see what is committed plus their own writes. A statement that fails aborts the transaction, which can then only roll back.
- **Row locks.** These take Postgres's modes: `lock: "update"` and deletes lock the row, updates lock it against other updates, and a reference locks the row it points at against deletion. A second unit of work waits for the first to commit or roll back, then reads the row as it is. Two that would wait for each other fail one of them with a deadlock error.
- **Copies.** Rows are copied in and out, so an object held outside the unit of work can't change what is stored.
- **SQL's nulls.** An empty value matches only `null` and `{ ne: … }` with a value given. It sorts last ascending and first descending.

What differs: strings compare and sort by code unit, not by the database's collation. Columns have no types, lengths or `NOT NULL` checks beyond the key and required references. And the rows last only as long as the app.

## Working on this package

For contributors to Decohere: how the package is laid out and tested. Using it needs nothing below.

`data-memory` implements data's `RowStore` in the process, under data's `TrackingUnitOfWork`. `src/` is flat: `memory.plugin.ts` (`memory(...)`), `memory-entity.ts` (`mapEntity`, the mapping), `memory.row-store.ts` (`MemoryRowStore`) and `memory.store.ts` (`MemoryStore` and its transactions: keys, locks and copies).

Its canonical suite is data's unit-of-work contract: the cases run on it in `projects/data/data/tests/unit-of-work.contract.spec.ts`, in `pnpm test` ([testing](../../../docs/contributing/testing/README.md#canonical-suite-ownership)). Here, `tests/memory.store.spec.ts` covers the store's keys, locks and copies, and `tests/memory.plugin.spec.ts` the plugin. Specs are in `tests/` today and move beside the code ([ADR 0027](../../../docs/contributing/adr/0027-code-design.md)).
