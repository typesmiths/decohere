# @decohere/data-mikro-orm

The MikroORM provider for [`@decohere/data`](../data/README.md): data's `IUnitOfWork` over MikroORM's own unit of work. MikroORM tracks the changes, keeps the identity map and orders the writes. This package adds Decohere's `Query<T>`, the outbox, and one rule: nothing is written before `commit()`. Each unit of work forks the entity manager with `flushMode: "commit"`, so a query never flushes pending changes.

```ts
import { mikroOrm } from "@decohere/data-mikro-orm";

builder.use(
	mikroOrm({
		entities: [OrderSchema, LineSchema],
		repositories: [OrderRepository],
		database: postgres, // from @decohere/data-postgres
		migrations, // from ./migrations/index.js
		outbox: toOutboxMessage,
	}),
);
```

`mikroOrm()` reads the `database` config section, like `typeOrm()`. When the app is built, it connects to nothing; for each data source it:

- checks the data source's `auth`, `synchronize` and `migrateOnStart`;
- creates one MikroORM instance as the app role, named for the app in `application_name`, not yet connected;
- registers a unit of work per request (`@injectUnitOfWork()`), the instance itself (`@injectMikroOrm()`) and a readiness check;
- registers the data source's migrations and schema diff for the db commands, when given a `database`.

When the app starts, before hosted services and the server, it:

- creates the database, least-privilege roles and schema when the config asks, with the `database` you pass, then connects each instance;
- applies pending migrations when `migrateOnStart` is on (development only);
- creates missing tables when `synchronize` is on (development only), never dropping any;
- runs `seed(orm)` when `seed` is on.

If the database is down, that step is retried until it isn't, holding back the hosted services; until then a request for the unit of work answers 503 ([data](../data/README.md#setting-up-the-database)).

`db generate` takes MikroORM's schema diff, connected as the migrate role. MikroORM proposes dropping every table it sees and doesn't map, so the role's reach to its own schema is what keeps another app's tables out of the diff. The history table is skipped by name, and `create schema` and `drop schema` are left out: schemas are the bootstrap's. `synchronize` leaves out `create schema` for the same reason: the app role may not run it even when the schema exists.

The container closes the instance when the app stops, after hosted services. Postgres only. Outside a plugin, `new MikroOrmUnitOfWork(orm.em, { outbox })` gives the same unit of work.

Map domain classes with `defineEntity({ class, … })` in infrastructure files, so the domain imports nothing from MikroORM. Map each child collection as a one-to-many with `orphanRemoval()`, so a child dropped from its aggregate is deleted. Map a field loaded only when asked for with `.lazy()`: `load` populates it, as `include` does a collection ([data](../data/README.md#fields-loaded-only-on-request)).

`new MikroOrmMapping(entities)` reads MikroORM's mapping of `entities` (what `mikroOrm()` takes) without connecting, so the memory provider runs on it with nothing mapped twice: `memory({ entities: new MikroOrmMapping([OrderSchema, LineSchema]) })` ([data-memory](../data-memory/README.md#taking-an-orms-mapping)). It runs MikroORM's discovery on its own, which leaves the classes unchanged. Map on the relation what the database does on delete (`.deleteRule("cascade")`): memory knows only what the mapping says.

Things to know:

- **MikroORM changes the classes it maps** at run time: field accessors, `toJSON` and a `__helper`. A loaded child also carries its parent. Map HTTP responses to DTOs rather than serialising entities. Don't map one class with two providers in one process.
- **Version fields** need a database default (`version int not null default 1`). MikroORM leaves the column to it on insert.
- **`addIfAbsent(entity)`** ([data](../data/README.md#add-unless-its-already-kept)) is the one write before `commit()`. MikroORM has no insert-if-absent for an entity, so it builds one with the query builder (`insert(…).onConflict().ignore().returning(…)`), in the unit of work's transaction, and on `true` sets the generated key and version and merges the entity (`em.merge`), so MikroORM tracks it as loaded, and persists its children, which the commit writes. An entity already in its identity map or persist stack is refused.
- **SQL a query can't express** goes through `transaction()`, below.

## A repository's own SQL

`MikroOrmUnitOfWork.transaction()` opens the unit of work's transaction if none is open, and returns its forked entity manager. `em.execute()`, `em.getKysely()` and `em.createQueryBuilder()` then run on the transaction's connection: what they write commits or rolls back with the unit of work, and they see what it has written in that transaction ([data](../data/README.md#a-repositorys-own-sql)). A repository that needs it injects the unit of work as `MikroOrmUnitOfWork`:

```ts
@injectable()
export class ReceiptRepository extends Repository<Receipt> {
	public constructor(@injectUnitOfWork() private readonly mikroOrm: MikroOrmUnitOfWork) {
		super(mikroOrm, Receipt);
	}

	public async totalFor(account: string): Promise<number> {
		const em = await this.mikroOrm.transaction();
		const [row] = await em.execute("select coalesce(sum(amount), 0) as total from receipt where account = ?", [account]);
		return Number(row.total);
	}
}
```

The entity manager runs with `flushMode: "commit"`, so a statement doesn't flush pending changes first: it sees the database as this transaction has written it. `entityManager` gives the same entity manager without opening a transaction; a statement run through it outside one commits on its own.

## Working on this package

For contributors to Decohere: how the package is laid out and tested. Using it needs nothing below.

`data-mikro-orm` implements data's `IUnitOfWork` on MikroORM. `src/` is flat: `mikro-orm.module.ts` (the `mikroOrm(...)` plugin and `MikroOrmModule`, which opens the data sources), `mikro-orm.unit-of-work.ts` (`MikroOrmUnitOfWork`), `mikro-orm-mapping.provider.ts` (`MikroOrmMapping`, data's `EntityMapping`) and `inject-mikro-orm.ts` (`@injectMikroOrm()`).

Its canonical suite is data's unit-of-work contract, `projects/data/data/tests/unit-of-work.contract.docker.spec.ts`, where MikroORM's writes are the snapshotted reference ([testing](../../../docs/contributing/testing/README.md#canonical-suite-ownership)). Here, `tests/mikro-orm.module.spec.ts` covers the plugin's wiring and `tests/mikro-orm.plugin.docker.spec.ts` runs it against Postgres. `src/mikro-orm-mapping.provider.spec.ts` covers the models `MikroOrmMapping` reads. Specs are in `tests/` today and move beside the code ([ADR 0027](../../../docs/contributing/adr/0027-code-design.md)).
