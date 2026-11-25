import { DataSource, type EntityMetadata } from "typeorm";
import type { Entity } from "./database-options.js";

/**
 * Builds TypeORM's metadata for a list of entities, as `initialize()` does, without connecting:
 * a data source that is never initialized, so it opens no pool. TypeORM's own builder and
 * validator read the mapping, so it says what a connected data source would.
 */
export class TypeOrmMetadataFactory extends DataSource {
	public constructor(entities: readonly Entity[]) {
		super({ type: "postgres", entities: [...entities] });
	}

	public async create(): Promise<EntityMetadata[]> {
		await this.buildMetadatas();
		return [...this.entityMetadatas];
	}
}
