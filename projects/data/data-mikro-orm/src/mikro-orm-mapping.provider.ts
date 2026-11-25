import {
	type ChildrenModel,
	DataConfigurationError,
	type EntityClass,
	type EntityMapping,
	type EntityModel,
	type ReferenceModel,
} from "@decohere/data";
import {
	Configuration,
	type EntityMetadata,
	type EntityProperty,
	MetadataDiscovery,
	MetadataStorage,
	ReferenceKind,
} from "@mikro-orm/core";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import type { MikroOrmModuleConfig } from "./mikro-orm.module.js";

/**
 * The classes MikroORM maps, read as data's models without connecting, so another provider runs on
 * the same mapping: `memory({ entities: new MikroOrmMapping([OrderSchema, LineSchema]) })`. Takes
 * what `mikroOrm()` takes as `entities`. It runs MikroORM's discovery on its own, which reads the
 * mapping and leaves the classes as they are: only a MikroORM instance changes them.
 */
export class MikroOrmMapping implements EntityMapping {
	private readonly entities: MikroOrmModuleConfig["entities"];

	public constructor(entities: MikroOrmModuleConfig["entities"]) {
		this.entities = [...entities];
	}

	public async models(): Promise<EntityModel[]> {
		const config = new Configuration(
			{ driver: PostgreSqlDriver, entities: this.entities, metadataCache: { enabled: false } },
			false,
		);
		const storage = new MetadataDiscovery(
			new MetadataStorage(),
			config.getPlatform(),
			config,
		).discoverSync();
		const models: EntityModel[] = [];
		for (const meta of storage) {
			// Tables only: not embeddables, abstract bases, virtual entities or many-to-many pivots.
			if (meta.embeddable || meta.abstract || meta.virtual || meta.pivotTable) {
				continue;
			}
			models.push(this.modelOf(meta));
		}
		return models;
	}

	private modelOf(meta: EntityMetadata): EntityModel {
		const name = meta.className;
		if (typeof meta.class !== "function") {
			throw new DataConfigurationError(`${name} must be mapped to a class to be tracked`);
		}
		const fields: string[] = [];
		const lazy: string[] = [];
		const references: ReferenceModel[] = [];
		const children: ChildrenModel[] = [];
		for (const prop of meta.props) {
			if (prop.persist === false) {
				continue;
			}
			switch (prop.kind) {
				case ReferenceKind.SCALAR:
					fields.push(prop.name);
					if (prop.lazy) {
						lazy.push(prop.name);
					}
					break;
				case ReferenceKind.MANY_TO_ONE:
					references.push(this.referenceOf(name, prop));
					break;
				case ReferenceKind.ONE_TO_ONE:
					// The inverse side has no column: the owner's reference is the one stored.
					if (prop.owner) {
						references.push(this.referenceOf(name, prop));
					}
					break;
				case ReferenceKind.ONE_TO_MANY:
					children.push({
						prop: prop.name,
						target: prop.targetMeta.class as EntityClass,
						parentRef: prop.mappedBy,
						orderBy: this.orderOf(name, prop),
					});
					break;
				case ReferenceKind.MANY_TO_MANY:
					throw new DataConfigurationError(
						`${name}.${prop.name}: many-to-many relations aren't supported`,
					);
				default:
					throw new DataConfigurationError(
						`${name}.${prop.name}: ${prop.kind} properties aren't supported`,
					);
			}
		}
		const key = [...meta.primaryKeys];
		const [onlyKey] = key;
		const generated =
			key.length === 1 && meta.properties[onlyKey].autoincrement ? onlyKey : undefined;
		return {
			type: meta.class as EntityClass,
			name,
			key,
			fields,
			references,
			children,
			version: meta.versionProperty,
			generated,
			lazy,
		};
	}

	private referenceOf(name: string, prop: EntityProperty): ReferenceModel {
		const target = prop.targetMeta;
		if (target.primaryKeys.length !== 1) {
			throw new DataConfigurationError(
				`${name}.${prop.name} references a composite key, which the unit of work can't track`,
			);
		}
		return {
			prop: prop.name,
			target: target.class as EntityClass,
			nullable: prop.nullable ?? false,
			onDelete: prop.deleteRule === "cascade" ? "cascade" : undefined,
		};
	}

	/** A child collection's `orderBy`, as `{ prop: "asc" | "desc" }`. */
	private orderOf(name: string, prop: EntityProperty): ChildrenModel["orderBy"] {
		if (prop.orderBy == null) {
			return undefined;
		}
		const order: Record<string, "asc" | "desc"> = {};
		const maps = Array.isArray(prop.orderBy) ? prop.orderBy : [prop.orderBy];
		for (const [field, direction] of maps.flatMap((map) => Object.entries(map))) {
			if (typeof direction === "number") {
				order[field] = direction < 0 ? "desc" : "asc";
			} else if (typeof direction === "string") {
				order[field] = direction.toLowerCase().startsWith("desc") ? "desc" : "asc";
			} else {
				throw new DataConfigurationError(
					`${name}.${prop.name} is ordered by ${field}'s fields: order children by their own fields`,
				);
			}
		}
		return order;
	}
}
