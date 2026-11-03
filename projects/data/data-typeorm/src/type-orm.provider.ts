import type { Entity, IDataProvider } from "@decohere/data";
import type { Constructable } from "@decohere/core/reflection";
import type { FindManyOptions, FindOneOptions } from "typeorm";
import type { TypeOrmUnitOfWork } from "./unit-of-work.js";

export class TypeOrmQueryProvider implements IDataProvider {
	public constructor(private unitOfWork: TypeOrmUnitOfWork) {}

	public firstOrDefault<T extends Entity>(
		entity: Constructable<T>,
		options: FindOneOptions<T>,
	) {
		return this.unitOfWork.entityManager.findOne(entity, options);
	}

	public all<T>(entity: Constructable, options?: FindManyOptions<T>): Promise<T[]> {
		return this.unitOfWork.getRepository<T>(entity).find(options);
	}

	public findById<T extends Entity>(entity: Constructable<T>, key: number | string) {
		return this.unitOfWork.entityManager.findOneBy<Entity>(entity, {
			id: key,
		}) as Promise<T>;
	}

	public save<T>(entity: T): Promise<T> {
		return this.unitOfWork.entityManager.save(entity);
	}

	public query<T extends Entity>(entity: Constructable<T>, filter: FindManyOptions<T>) {
		return this.unitOfWork.entityManager.find(entity, filter);
	}

	public delete<T>(entity: T) {
		return this.unitOfWork.entityManager.remove(entity);
	}
}
