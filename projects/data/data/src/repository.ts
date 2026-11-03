import type { Constructable } from "@decohere/core/reflection";
import type { Entity } from "./data.types.js";
import type { IDataProvider } from "./data-provider.js";

export interface IRepository<T> {
	find(key: string): Promise<T>;
}

export abstract class Repository<T extends Entity> implements IRepository<T> {
	protected abstract readonly provider: IDataProvider;
	protected abstract readonly type: Constructable<T>;

	public find(key: string | number): Promise<T> {
		return this.provider.findById(this.type, key);
	}

	public save(entity: T): Promise<T> {
		return this.provider.save(entity);
	}

	public async delete(entity: T) {
		await this.provider.delete(entity);
	}

	public async all(): Promise<T[]> {
		return this.provider.all(this.type);
	}
}
