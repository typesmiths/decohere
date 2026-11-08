# @decohere/data

The data contracts a Decohere app's repositories are written against, with no ORM in them. A provider package puts an ORM under them: [`@decohere/data-mikro-orm`](../data-mikro-orm/README.md) or [`@decohere/data-typeorm`](../data-typeorm/README.md). Why it's built this way: [ADR 0024](../../../docs/adr/0024-default-orm.md).

## The unit of work

Each request gets one `IUnitOfWork`, injected with `@injectUnitOfWork()`. It promises the same on every provider:

- **An identity map.** A row loaded twice in one unit of work is the same object. `findById` answers from it without asking the database.
- **Change tracking.** Change anything it loaded, then `commit()`: it writes only the fields that changed, with no save call. `add(entity)` inserts a new one and its children; `remove(entity)` deletes one and the children it loaded. It never loads more rows to delete them: declare `ON DELETE CASCADE` on a child's foreign key when its parent may be removed without loading it.
- **One transaction.** A commit writes every change in one transaction, parents before children, children deleted before their parents. Rows that reference each other are inserted with the nullable reference empty, then updated.
- **Version checks.** When the mapping has a version field, an update matches only the version it loaded, and a lost race throws `OptimisticLockError`.
- **An outbox.** With an `outbox` mapper configured, events an aggregate raises (`RaisesEvents.pullEvents()`) are written in the same commit.
- **Nothing before commit.** Reads never write pending changes. Disposing without a commit rolls back. After a failed commit the unit of work is rolled back and refuses further use: start a new one.

```ts
const order = await uow.findById(Order, id, ["lines"]);
order.lines.add(new Line("apple", 2));
order.note = "gift";
await uow.commit(); // INSERT line, UPDATE orders SET note, version
```

## Queries

`find`, `findOne` and `findById` take a `Query<T>` in Decohere's terms, checked by the compiler against the entity's own fields:

```ts
await uow.find(Order, {
	where: { status: "open", placedAt: { lt: cutoff }, note: null, customer: { in: names } },
	orderBy: { placedAt: "desc" },
	limit: 50,
	include: ["lines", "lines.parts"], // child collections, nested up to three deep
	lock: "update", // SELECT … FOR UPDATE, in a transaction it opens
});
```

Operators: a bare value or `null` (equal), `in`, `ne`, `gt`, `gte`, `lt`, `lte`. A reference compares with an entity or its key. For what a query can't express (joins across aggregates, aggregates in SQL), use the provider's own escape hatch inside the repository.

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

`Repository<T>` gives `findById`, `find`, `findOne`, `add` and `remove`. The service that finishes the work commits the unit of work.

## For provider authors

A provider either wraps an ORM's own unit of work (as `data-mikro-orm` does) or uses `TrackingUnitOfWork`, which does the tracking itself over a `RowStore`: the mapping as an `EntityModel`, the transaction, and four row operations (`select`, `insert`, `update`, `delete`) on plain rows.

MikroORM's unit of work is the reference. `tests/unit-of-work.contract.docker.spec.ts` runs every case on both providers against Postgres. It snapshots the writes MikroORM sends and checks the tracker sends the same writes. The comparison covers statements, order, tables, rows, the columns each update sets, and locking reads. Plain reads aren't compared, because the providers may batch them differently. It also checks each case's outcome.

### Upgrading MikroORM

1. Bump `@mikro-orm/*` in the root `package.json` and install.
2. Run `pnpm test:docker projects/data/data/tests/unit-of-work.contract.docker.spec.ts`.
3. If a snapshot changed, MikroORM's behaviour changed. Either make the tracker follow it, so both providers pass with the new snapshot (`-u`), or keep the old behaviour and record the difference in that case, with the reason.
