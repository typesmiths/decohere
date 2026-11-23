# @decohere/data-typeorm

The TypeORM provider for [`@decohere/data`](../data/README.md), on TypeORM 1.x. TypeORM keeps no identity map and tracks no changes, so the unit of work is data's `TrackingUnitOfWork`. Under it, `TypeOrmRowStore` reads the mapping from TypeORM's metadata and runs plain row operations through TypeORM's query builders. The contract suite checks it sends the same writes as MikroORM.

```ts
// order.typeorm.ts: Order (in the domain) imports no ORM; this file maps it.
export const ORDER = new EntitySchema<Order>({
	name: "Order",
	target: Order,
	tableName: "orders",
	columns: { id: { type: "uuid", primary: true }, customer: { type: "text" } },
	relations: {
		lines: { type: "one-to-many", target: "Line", inverseSide: "order", persistence: false },
	},
});

builder.use(
	typeOrm({
		entities: [ORDER, LINE],
		repositories: [OrderRepository],
		database: postgres, // from @decohere/data-postgres
		migrations, // from ./migrations/index.js
		outbox: toOutboxMessage,
	}),
);
```

`entities` takes `EntitySchema`s, which keep TypeORM out of the domain ([data](../data/README.md)), or classes decorated with TypeORM's own decorators. Not file globs: TypeORM would load those files itself, outside flux.

`typeOrm()` registers one `DataSource` per data source (a singleton, injected with `@injectDataSource()`) and one unit of work per request (injected with `@injectUnitOfWork()`). Given `database: postgres` (from `@decohere/data-postgres`), it creates databases, least-privilege roles and schemas when the config asks, and registers each data source's migrations and schema diff for the db commands. `db generate` takes TypeORM's schema builder diff, connected as the migrate role. It refuses a statement that needs separate parameters, which a migration can't hold.

Building the app connects to nothing. When the app starts, before hosted services and the server, it bootstraps (given a `database`) and initializes each `DataSource`, then each data source applies pending migrations (`migrateOnStart`), synchronizes (`synchronize`) and seeds (`seed(dataSource)`), as its config says. TypeORM itself is never given `synchronize`. If the database is down, that step is retried until it isn't, holding back the hosted services; until then a request for the unit of work answers 503 ([data](../data/README.md#setting-up-the-database)). A singleton that injects the `DataSource` itself gets it uninitialized until then.

Config is plain data, so a TypeORM option that isn't, such as a `driver`, is given in code: `typeOrm({ …, dataSourceOptions: { driver } })`. It is spread over what config gives, so code wins only for what it sets. An app whose data sources share one `pg` pool passes each the same driver. `db generate`'s connection as the migrate role doesn't use it.

Mapping rules for the tracker:

- **Child collections** are mapped as one-to-many with `persistence: false`. The unit of work writes them, and TypeORM would otherwise refuse a class that starts them as a `ChildList`.
- **References** are many-to-one (or owning one-to-one) with a single join column.
- **Embedded columns** aren't supported.
- A **version column** (`version: true`) is checked and incremented on every update.
