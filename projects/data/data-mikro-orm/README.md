# @decohere/data-mikro-orm

The MikroORM provider for [`@decohere/data`](../data/README.md): data's `IUnitOfWork` over MikroORM's own unit of work. MikroORM tracks the changes, keeps the identity map and orders the writes. This package adds Decohere's `Query<T>`, the outbox, and one rule: nothing is written before `commit()`. Each unit of work forks the entity manager with `flushMode: "commit"`, so a query never flushes pending changes.

```ts
import { MikroOrmUnitOfWork } from "@decohere/data-mikro-orm";

const uow = new MikroOrmUnitOfWork(orm.em, { outbox: (event) => new OutboxMessage(event.type, event.payload) });
```

Map domain classes with `defineEntity({ class, … })` in infrastructure files, so the domain imports nothing from MikroORM. Map each child collection as a one-to-many with `orphanRemoval()`, so a child dropped from its aggregate is deleted.

Things to know:

- **MikroORM changes the classes it maps** at run time: field accessors, `toJSON` and a `__helper`. A loaded child also carries its parent. Map HTTP responses to DTOs rather than serialising entities. Don't map one class with two providers in one process.
- **Version fields** need a database default (`version int not null default 1`). MikroORM leaves the column to it on insert.
- **SQL a query can't express:** `uow.entityManager.getKysely()`, inside a repository.
