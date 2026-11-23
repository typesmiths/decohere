import {
	comparison,
	DataError,
	domainEvents,
	type EntityClass,
	type EntityKey,
	type FieldKeys,
	type FindByIdArgument,
	type Include,
	isIncludeList,
	type IUnitOfWork,
	OptimisticLockError,
	type OutboxMapper,
	type Query,
	TransactionSettings,
	type TransactionSettingsSource,
	type Where,
} from "@decohere/data";
import {
	type EntityName,
	type FilterQuery,
	type FindOptions,
	FlushMode,
	LockMode,
	OptimisticLockError as MikroOptimisticLockError,
	ReferenceKind,
} from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";

/** A populate hint: a child collection to include, or a lazy field to load. MikroORM takes both as property paths. */
type Path<T> = Include<T> | FieldKeys<T>;

export type MikroOrmUnitOfWorkOptions = {
	/** Writes the events aggregates raise to an outbox entity, in the same commit. */
	outbox?: OutboxMapper;
	/**
	 * Settings made at the start of each transaction, as MikroORM's session context: while they
	 * name any, MikroORM runs a read outside a transaction in one of its own.
	 */
	settings?: TransactionSettingsSource;
};

/**
 * The MikroORM provider: data's unit of work over MikroORM's own. MikroORM tracks the changes,
 * keeps the identity map and orders the writes; this adds Decohere's query, the outbox, and
 * one rule: nothing is written before {@link commit}, so the entity manager never auto-flushes.
 */
export class MikroOrmUnitOfWork implements IUnitOfWork {
	private readonly em: EntityManager;
	private failure: unknown;
	private disposed = false;

	/** @param em the application's entity manager; each unit of work forks its own. */
	public constructor(
		em: EntityManager,
		private readonly options: MikroOrmUnitOfWorkOptions = {},
	) {
		this.em = em.fork({ clear: true, flushMode: FlushMode.COMMIT });
	}

	/** The entity manager behind this unit of work. For SQL of a repository's own, use {@link transaction}. */
	public get entityManager(): EntityManager {
		return this.em;
	}

	/**
	 * The entity manager, with this unit of work's transaction open (begun now if none is), for a
	 * provider-side repository's own SQL: `em.execute()`, `em.getKysely()` or
	 * `em.createQueryBuilder()` then run on its connection. What they write commits or rolls back
	 * with the unit of work, and they see what it has written. They bypass the identity map and change
	 * tracking.
	 */
	public async transaction(): Promise<EntityManager> {
		await this.beginTransaction();
		return this.em;
	}

	public findById<T extends object>(
		type: EntityClass<T>,
		key: EntityKey<T>,
		options: FindByIdArgument<T> = {},
	): Promise<T | null> {
		this.assertUsable();
		this.useSettings();
		const { include = [], load = [] } = isIncludeList(options)
			? { include: options }
			: options;
		const where = (
			key !== null && typeof key === "object" ? toFilter(key as Where<T>) : key
		) as FilterQuery<T>;
		// MikroORM populates a lazy field as it does a collection.
		const populate: readonly Path<T>[] = [...include, ...load];
		return this.em.findOne(entityName(type), where, { populate } as FindOptions<T>);
	}

	public async find<T extends object>(
		type: EntityClass<T>,
		query: Query<T> = {},
	): Promise<T[]> {
		this.assertUsable();
		this.useSettings();
		if (query.lock && !this.em.isInTransaction()) {
			await this.em.begin();
		}
		const populate: readonly Path<T>[] = [...(query.include ?? []), ...(query.load ?? [])];
		const options = {
			orderBy: query.orderBy,
			limit: query.limit,
			populate,
			...(query.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
		} as FindOptions<T>;
		return this.em.find(
			entityName(type),
			toFilter(query.where ?? {}) as FilterQuery<T>,
			options,
		);
	}

	public async findOne<T extends object>(type: EntityClass<T>, query: Query<T> = {}) {
		const [found] = await this.find(type, { ...query, limit: 1 });
		return found ?? null;
	}

	public add(entity: object) {
		this.assertUsable();
		this.em.persist(entity);
	}

	public async addIfAbsent(entity: object): Promise<boolean> {
		this.assertUsable();
		const type = entityName(entity.constructor as EntityClass);
		const meta = this.em.getMetadata().get(type);
		const uow = this.em.getUnitOfWork();
		const held =
			uow.getPersistStack().has(entity) || [...uow.getIdentityMap().values()].includes(entity);
		if (held) {
			throw new DataError(
				`${meta.className}: addIfAbsent takes a new entity, not one this unit of work holds`,
			);
		}
		const em = await this.transaction();
		// What the database fills in (a generated key, the version's default) comes back to the entity.
		const generated = meta.props.filter((p) => p.autoincrement || p.version);
		const result = await em
			.createQueryBuilder(type)
			.insert(em.getComparator().prepareEntity(entity))
			.onConflict()
			.ignore()
			.returning([...new Set([...meta.primaryKeys, ...generated.map((p) => p.name)])])
			.execute("run");
		const [inserted] = result.rows ?? [];
		if (inserted === undefined) {
			return false;
		}
		for (const prop of generated) {
			entity[String(prop.name)] = inserted[prop.fieldNames[0]];
		}
		// Its children are new: written on commit, with the rest of the unit of work. Taken before the
		// merge, which attaches the entity as it is in the database: with no children.
		const children = meta.relations
			.filter((prop) => prop.kind === ReferenceKind.ONE_TO_MANY)
			.flatMap((prop) => [...((entity[prop.name] as Iterable<object> | undefined) ?? [])]);
		em.merge(entity);
		for (const child of children) {
			em.persist(child);
		}
		return true;
	}

	public remove(entity: object) {
		this.assertUsable();
		this.em.remove(entity);
	}

	public async beginTransaction() {
		this.assertUsable();
		this.useSettings();
		if (!this.em.isInTransaction()) {
			await this.em.begin();
		}
	}

	public async commit() {
		this.assertUsable();
		this.useSettings();
		try {
			if (this.options.outbox) {
				const uow = this.em.getUnitOfWork();
				const entities = [...uow.getIdentityMap().values(), ...uow.getPersistStack()];
				for (const row of domainEvents.collect(entities, this.options.outbox)) {
					this.em.persist(row);
				}
			}
			// em.commit() flushes, then commits; outside a transaction, flush opens and commits its own.
			if (this.em.isInTransaction()) {
				await this.em.commit();
			} else {
				await this.em.flush();
			}
		} catch (err) {
			this.failure = err;
			if (this.em.isInTransaction()) {
				await this.em.rollback();
			}
			if (err instanceof MikroOptimisticLockError) {
				throw new OptimisticLockError(err.message, { cause: err });
			}
			throw err;
		}
	}

	public async [Symbol.asyncDispose]() {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		try {
			if (this.em.isInTransaction()) {
				await this.em.rollback();
			}
		} finally {
			this.em.clear();
		}
	}

	/**
	 * Give MikroORM the source's settings as they are now, for the next transaction it begins. It
	 * refuses a change inside a transaction, which began with the settings it has.
	 */
	private useSettings() {
		const source = this.options.settings;
		if (source == null || this.em.isInTransaction()) {
			return;
		}
		const settings = TransactionSettings.of(source.transactionSettings());
		// setSessionContext merges, so a setting the source no longer names would stay.
		this.em.clearSessionContext();
		if (!settings.isEmpty) {
			this.em.setSessionContext({ variables: Object.fromEntries(settings.entries()) });
		}
	}

	private assertUsable() {
		if (this.disposed) {
			throw new DataError("This unit of work was disposed");
		}
		if (this.failure !== undefined) {
			throw new DataError(
				"A commit failed in this unit of work, so it was rolled back: start a new one",
				{
					cause: this.failure,
				},
			);
		}
	}
}

/** Decohere's entity class as MikroORM names it. The two describe the same constructor. */
function entityName<T extends object>(type: EntityClass<T>): EntityName<T> {
	return type as unknown as EntityName<T>;
}

/** Decohere's conditions in MikroORM's operators: `{ in: [...] }` becomes `{ $in: [...] }`. */
function toFilter(where: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(where).map(([prop, condition]) => {
			const operator = comparison.operatorOf(condition);
			if (!operator) {
				return [prop, condition];
			}
			const [op, operand] = operator;
			return [prop, { [`$${op}`]: operand }];
		}),
	);
}
