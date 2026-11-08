import type { EntityClass, EntityKey, Include, Query } from "./query.types.js";

/**
 * One request's view of the database. What every provider promises:
 * - an identity map: a row loaded twice in one unit of work is the same object;
 * - change tracking: changes to anything it loaded or was given are written on {@link commit},
 *   with no save call, and only the fields that changed;
 * - one commit writes every change, and the outbox, in one transaction;
 * - a version field, when the mapping has one, is checked on update ({@link OptimisticLockError});
 * - disposing it without a commit rolls back.
 *
 * After a commit it can be used again. After a commit fails it is rolled back and refuses
 * further use: start a new one.
 */
export interface IUnitOfWork extends AsyncDisposable {
	findById<T extends object>(
		type: EntityClass<T>,
		key: EntityKey<T>,
		include?: readonly Include<T>[],
	): Promise<T | null>;
	find<T extends object>(type: EntityClass<T>, query?: Query<T>): Promise<T[]>;
	findOne<T extends object>(type: EntityClass<T>, query?: Query<T>): Promise<T | null>;
	/** Insert this new entity, and its children, on commit. */
	add(entity: object): void;
	/** Delete this entity, and its children, on commit. */
	remove(entity: object): void;
	/** Open the transaction now rather than at commit, for reads that must see one snapshot. */
	beginTransaction(): Promise<void>;
	/** Write every change in one transaction, and commit it. */
	commit(): Promise<void>;
}
