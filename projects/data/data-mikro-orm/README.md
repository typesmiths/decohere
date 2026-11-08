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

`mikroOrm()` reads the `database` config section, like `typeOrm()`. When the app is built, for each data source it:

- checks the data source's `auth`, `synchronize` and `migrateOnStart`, and creates its database, least-privilege roles and schema when the config asks, with the `database` you pass;
- opens one MikroORM instance as the app role, named for the app in `application_name`;
- registers a unit of work per request (`@injectUnitOfWork()`), the instance itself (`@injectMikroOrm()`) and a readiness check;
- registers the data source's migrations and schema diff for the db commands, when given a `database`.

When the app starts, before hosted services and the server, it:

- applies pending migrations when `migrateOnStart` is on (development only);
- creates missing tables when `synchronize` is on (development only), never dropping any;
- runs `seed(orm)` when `seed` is on.

`db generate` takes MikroORM's schema diff, connected as the migrate role. MikroORM proposes dropping every table it sees and doesn't map, so the role's reach to its own schema is what keeps another app's tables out of the diff. The history table is skipped by name, and `create schema` and `drop schema` are left out: schemas are the bootstrap's. `synchronize` leaves out `create schema` for the same reason: the app role may not run it even when the schema exists.

The container closes the instance when the app stops, after hosted services. Postgres only. Outside a plugin, `new MikroOrmUnitOfWork(orm.em, { outbox })` gives the same unit of work.

Map domain classes with `defineEntity({ class, … })` in infrastructure files, so the domain imports nothing from MikroORM. Map each child collection as a one-to-many with `orphanRemoval()`, so a child dropped from its aggregate is deleted.

Things to know:

- **MikroORM changes the classes it maps** at run time: field accessors, `toJSON` and a `__helper`. A loaded child also carries its parent. Map HTTP responses to DTOs rather than serialising entities. Don't map one class with two providers in one process.
- **Version fields** need a database default (`version int not null default 1`). MikroORM leaves the column to it on insert.
- **SQL a query can't express:** `uow.entityManager.getKysely()`, inside a repository.
