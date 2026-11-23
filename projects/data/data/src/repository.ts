import type { EntityClass, EntityKey, FindByIdArgument, Query } from "./query.types.js";
import type { IUnitOfWork } from "./unit-of-work.js";

/** A repository for one aggregate, over the request's unit of work. Subclasses add the queries the domain needs. */
export abstract class Repository<T extends object> {
	protected constructor(
		protected readonly unitOfWork: IUnitOfWork,
		protected readonly type: EntityClass<T>,
	) {}

	public findById(key: EntityKey<T>, options?: FindByIdArgument<T>): Promise<T | null> {
		return this.unitOfWork.findById(this.type, key, options);
	}

	public find(query?: Query<T>): Promise<T[]> {
		return this.unitOfWork.find(this.type, query);
	}

	public findOne(query?: Query<T>): Promise<T | null> {
		return this.unitOfWork.findOne(this.type, query);
	}

	public add(entity: T) {
		this.unitOfWork.add(entity);
	}

	/** Insert it now unless its key is already kept; true when it was new. See {@link IUnitOfWork.addIfAbsent}. */
	public addIfAbsent(entity: T): Promise<boolean> {
		return this.unitOfWork.addIfAbsent(entity);
	}

	public remove(entity: T) {
		this.unitOfWork.remove(entity);
	}
}
