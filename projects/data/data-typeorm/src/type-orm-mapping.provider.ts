import type { EntityMapping, EntityModel } from "@decohere/data";
import type { Entity } from "./database-options.js";
import { TypeOrmEntityModel } from "./type-orm-entity.model.js";
import { TypeOrmMetadataFactory } from "./type-orm-metadata.factory.js";

/**
 * The classes TypeORM maps, read as data's models without connecting, so another provider runs on
 * the same mapping: `memory({ entities: new TypeOrmMapping([Order, Line]) })`. Takes what
 * `typeOrm()` takes as `entities`: classes with TypeORM's decorators, or `EntitySchema`s.
 */
export class TypeOrmMapping implements EntityMapping {
	private readonly entities: readonly Entity[];

	public constructor(entities: readonly Entity[]) {
		this.entities = [...entities];
	}

	public async models(): Promise<EntityModel[]> {
		const metadata = await new TypeOrmMetadataFactory(this.entities).create();
		// Tables only: not views, nor the junction tables TypeORM adds for many-to-many relations.
		return metadata
			.filter((meta) => meta.tableType === "regular")
			.map((meta) => new TypeOrmEntityModel(meta).model);
	}
}
