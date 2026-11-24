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
- A column with **`select: false`** is loaded only when a query asks for it with `load` ([data](../data/README.md#fields-loaded-only-on-request)).

`addIfAbsent(entity)` ([data](../data/README.md#add-unless-its-already-kept)) is the row store's `insertIfAbsent`: TypeORM's insert builder with `orIgnore()`, returning the key and generated columns, in the unit of work's transaction. No row back means the key was kept.

`settings`, for row-level security ([data](../data/README.md#row-level-security)), is made by the row store as it begins each transaction: one `select set_config($1, $2, true), …` after `START TRANSACTION`. The tracker runs a read outside a transaction in one of its own while the source names any settings, as MikroORM does.

## A repository's own SQL

The unit of work `typeOrm()` registers is a `TypeOrmUnitOfWork` (data's `TrackingUnitOfWork` over a `TypeOrmRowStore`). Its `transaction()` opens the transaction if none is open and returns the row store, whose `queryRunner` is the unit of work's own connection. A statement run on it commits or rolls back with the unit of work, and sees what it has written in that transaction ([data](../data/README.md#a-repositorys-own-sql)). The `DataSource` is another connection: a statement run on it is outside the unit of work. A repository that needs its own SQL injects the unit of work as `TypeOrmUnitOfWork`:

```ts
@injectable()
export class ReceiptRepository extends Repository<Receipt> {
	public constructor(@injectUnitOfWork() private readonly typeOrm: TypeOrmUnitOfWork) {
		super(typeOrm, Receipt);
	}

	public async totalFor(account: string): Promise<number> {
		const { queryRunner } = await this.typeOrm.transaction();
		const [row] = await queryRunner.query("select coalesce(sum(amount), 0) as total from receipt where account = $1", [account]);
		return Number(row.total);
	}
}
```

The query runner also builds queries: `queryRunner.manager.createQueryBuilder()`.

## Working on this package

For contributors to Decohere: how the package is laid out and tested. Using it needs nothing below.

`data-typeorm` implements data's `RowStore` on TypeORM, under data's `TrackingUnitOfWork`. `src/` is flat: `typeorm.plugin.ts` (`typeOrm(...)`), `type-orm.module.ts` (`TypeOrmModule`, which opens the data sources), `data-source.factory.ts` and `database-options.ts`, `type-orm.row-store.ts` (`TypeOrmRowStore`), `inject-data-source.ts` (`@injectDataSource()`), and TypeORM's logging through Scribe (`typeorm-scribe.logger.ts`, `sql-pretty.transport.ts`).

Its canonical suite is data's unit-of-work contract, `projects/data/data/tests/unit-of-work.contract.docker.spec.ts`, which checks it sends the same writes as MikroORM ([testing](../../../docs/contributing/testing/README.md#canonical-suite-ownership)). Here, `tests/type-orm.module.spec.ts` and `tests/typeorm.lifecycle.spec.ts` cover the wiring and lifecycle, and `tests/tracked-entity.docker.spec.ts` runs against Postgres. Specs are in `tests/` today and move beside the code ([ADR 0027](../../../docs/contributing/adr/0027-code-design.md)).
