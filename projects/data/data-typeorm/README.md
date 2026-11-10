# @decohere/data-typeorm

The TypeORM provider for [`@decohere/data`](../data/README.md), on TypeORM 1.x. TypeORM keeps no identity map and tracks no changes, so the unit of work is data's `TrackingUnitOfWork`. Under it, `TypeOrmRowStore` reads the mapping from TypeORM's metadata and runs plain row operations through TypeORM's query builders. The contract suite checks it sends the same writes as MikroORM.

```ts
builder.use(
	typeOrm({
		entities: [Order, Line],
		repositories: [OrderRepository],
		database: postgres, // from @decohere/data-postgres
		migrations, // from ./migrations/index.js
		outbox: toOutboxMessage,
	}),
);
```

`typeOrm()` registers one `DataSource` per data source (a singleton, injected with `@injectDataSource()`) and one unit of work per request (injected with `@injectUnitOfWork()`). Given `database: postgres` (from `@decohere/data-postgres`), it creates databases, least-privilege roles and schemas when the config asks, and registers each data source's migrations and schema diff for the db commands. `db generate` takes TypeORM's schema builder diff, connected as the migrate role. It refuses a statement that needs separate parameters, which a migration can't hold.

When the app starts, before hosted services and the server, each data source applies pending migrations (`migrateOnStart`), synchronizes (`synchronize`) and seeds (`seed(dataSource)`), as its config says. TypeORM itself is never given `synchronize`, so building the app changes no tables.

Mapping rules for the tracker:

- **Child collections** are mapped as one-to-many with `persistence: false`. The unit of work writes them, and TypeORM would otherwise refuse a class that starts them as a `ChildList`.
- **References** are many-to-one (or owning one-to-one) with a single join column.
- **Embedded columns** aren't supported.
- A **version column** (`version: true`) is checked and incremented on every update.
