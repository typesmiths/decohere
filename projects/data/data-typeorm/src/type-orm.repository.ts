import { type Entity, Repository } from "@decohere/data";
import type { Constructable } from "@decohere/core/reflection";
import type { FindOneOptions } from "typeorm";
import { TypeOrmQueryProvider } from "./type-orm.provider.js";
import type { TypeOrmUnitOfWork } from "./unit-of-work.js";

export abstract class TypeOrmRepository<T extends Entity> extends Repository<T> {
	protected provider: TypeOrmQueryProvider;
	protected type: Constructable<T>;
	public constructor(unitOfWork: TypeOrmUnitOfWork, type: Constructable<T>) {
		super();
		this.type = type;
		this.provider = new TypeOrmQueryProvider(unitOfWork);
	}

	public firstOrDefault(options: FindOneOptions<T>): Promise<T | null>;
	public firstOrDefault<U extends Entity>(
		type: Constructable<U>,
		options: FindOneOptions<U>,
	): Promise<U | null>;
	public firstOrDefault<U extends Entity>(
		optionsOrType: FindOneOptions<T> | Constructable<U>,
		options?: FindOneOptions<U>,
	): Promise<T | U | null> {
		if (typeof optionsOrType === "function") {
			if (!options) {
				throw new Error("options parameter is required when type is provided");
			}
			return this.provider.firstOrDefault(optionsOrType, options);
		}
		return this.provider.firstOrDefault(this.type, optionsOrType);
	}
}
