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

Building the app connects to nothing. When the app starts, before hosted services and the server, it bootstraps (given a `database`) and initializes each `DataSource`, then each data source applies pending migrations (`migrateOnStart`), synchronizes (`synchronize`) and seeds (`seed(dataSource)`), as its config says. TypeORM itself is never given `synchronize`. If the database is down, that step is retried until it isn't, holding back the hosted services; until then a request for the unit of work answers 503 ([data](../data/README.md#setting-up-the-database)). A singleton that injects the `DataSource` itself gets it uninitialized until then.

Mapping rules for the tracker:

- **Child collections** are mapped as one-to-many with `persistence: false`. The unit of work writes them, and TypeORM would otherwise refuse a class that starts them as a `ChildList`.
- **References** are many-to-one (or owning one-to-one) with a single join column.
- **Embedded columns** aren't supported.
- A **version column** (`version: true`) is checked and incremented on every update.

## Working on this package

For contributors to Decohere: how the package is laid out and tested. Using it needs nothing below.

`data-typeorm` implements data's `RowStore` on TypeORM, under data's `TrackingUnitOfWork`. `src/` is flat: `typeorm.plugin.ts` (`typeOrm(...)`), `type-orm.module.ts` (`TypeOrmModule`, which opens the data sources), `data-source.factory.ts` and `database-options.ts`, `type-orm.row-store.ts` (`TypeOrmRowStore`), `inject-data-source.ts` (`@injectDataSource()`), and TypeORM's logging through Scribe (`typeorm-scribe.logger.ts`, `sql-pretty.transport.ts`).

Its canonical suite is data's unit-of-work contract, `projects/data/data/tests/unit-of-work.contract.docker.spec.ts`, which checks it sends the same writes as MikroORM ([testing](../../../docs/contributing/testing/README.md#canonical-suite-ownership)). Here, `tests/type-orm.module.spec.ts` and `tests/typeorm.lifecycle.spec.ts` cover the wiring and lifecycle, and `tests/tracked-entity.docker.spec.ts` runs against Postgres. Specs are in `tests/` today and move beside the code ([ADR 0027](../../../docs/contributing/adr/0027-code-design.md)).
