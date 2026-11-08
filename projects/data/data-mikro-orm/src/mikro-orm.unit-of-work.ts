import {
	comparison,
	DataError,
	domainEvents,
	type EntityClass,
	type EntityKey,
	type Include,
	type IUnitOfWork,
	OptimisticLockError,
	type OutboxMapper,
	type Query,
	type Where,
} from "@decohere/data";
import {
	type EntityManager,
	type EntityName,
	type FilterQuery,
	type FindOptions,
	FlushMode,
	LockMode,
	OptimisticLockError as MikroOptimisticLockError,
} from "@mikro-orm/core";

export type MikroOrmUnitOfWorkOptions = {
	/** Writes the events aggregates raise to an outbox entity, in the same commit. */
	outbox?: OutboxMapper;
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

	/** The entity manager behind this unit of work, for SQL a query can't express (`em.getKysely()`), inside a repository. */
	public get entityManager(): EntityManager {
		return this.em;
	}

	public findById<T extends object>(
		type: EntityClass<T>,
		key: EntityKey<T>,
		include: readonly Include<T>[] = [],
	): Promise<T | null> {
		this.assertUsable();
		const where = (
			key !== null && typeof key === "object" ? toFilter(key as Where<T>) : key
		) as FilterQuery<T>;
		return this.em.findOne(entityName(type), where, { populate: include } as FindOptions<T>);
	}

	public async find<T extends object>(
		type: EntityClass<T>,
		query: Query<T> = {},
	): Promise<T[]> {
		this.assertUsable();
		if (query.lock && !this.em.isInTransaction()) await this.em.begin();
		const options = {
			orderBy: query.orderBy,
			limit: query.limit,
			populate: query.include ?? [],
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

	public remove(entity: object) {
		this.assertUsable();
		this.em.remove(entity);
	}

	public async beginTransaction() {
		this.assertUsable();
		if (!this.em.isInTransaction()) await this.em.begin();
	}

	public async commit() {
		this.assertUsable();
		try {
			if (this.options.outbox) {
				const uow = this.em.getUnitOfWork();
				const entities = [...uow.getIdentityMap().values(), ...uow.getPersistStack()];
				for (const row of domainEvents.collect(entities, this.options.outbox))
					this.em.persist(row);
			}
			// em.commit() flushes, then commits; outside a transaction, flush opens and commits its own.
			if (this.em.isInTransaction()) await this.em.commit();
			else await this.em.flush();
		} catch (err) {
			this.failure = err;
			if (this.em.isInTransaction()) await this.em.rollback();
			if (err instanceof MikroOptimisticLockError) {
				throw new OptimisticLockError(err.message, { cause: err });
			}
			throw err;
		}
	}

	public async [Symbol.asyncDispose]() {
		if (this.disposed) return;
		this.disposed = true;
		try {
			if (this.em.isInTransaction()) await this.em.rollback();
		} finally {
			this.em.clear();
		}
	}

	private assertUsable() {
		if (this.disposed) throw new DataError("This unit of work was disposed");
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
			if (!operator) return [prop, condition];
			const [op, operand] = operator;
			return [prop, { [`$${op}`]: operand }];
		}),
	);
}
