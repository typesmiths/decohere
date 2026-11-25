import {
	DataConfigurationError,
	type EntityClass,
	type EntityModel,
	type ReferenceModel,
} from "@decohere/data";
import type { EntityMetadata } from "typeorm";

type ColumnMetadata = EntityMetadata["columns"][number];

/** How TypeORM generates a key that data's model calls `generated`: a number, counted up. */
const NUMBERED = new Set(["increment", "identity", "rowid"]);

/**
 * One class as TypeORM maps it, read from TypeORM's metadata: data's {@link EntityModel} for it,
 * and the column each of its properties is stored in. The TypeORM row store writes through it, and
 * `TypeOrmMapping` hands its model to another provider.
 */
export class TypeOrmEntityModel {
	private readonly columns = new Map<string, ColumnMetadata>();
	/** For each reference, the key property of the class it points at. */
	private readonly targetKeys = new Map<string, string>();
	private readonly entityModel: EntityModel;

	public constructor(private readonly meta: EntityMetadata) {
		const type = meta.target;
		if (typeof type !== "function") {
			throw new DataConfigurationError(`${meta.name} must be mapped to a class to be tracked`);
		}
		const references = this.readReferences();
		const referenceFor = (column: ColumnMetadata) =>
			column.relationMetadata?.propertyName ??
			references.find((r) => this.columns.get(r.prop)?.databaseName === column.databaseName)
				?.prop;
		const fields: string[] = [];
		const lazy: string[] = [];
		for (const column of meta.columns) {
			if (column.embeddedMetadata) {
				throw new DataConfigurationError(
					`${meta.name}.${column.propertyPath}: embedded columns aren't supported`,
				);
			}
			if (referenceFor(column) || column.isVirtual) {
				continue;
			}
			fields.push(column.propertyName);
			// `select: false`: loaded only when a query asks for it.
			if (!column.isSelect) {
				lazy.push(column.propertyName);
			}
			this.columns.set(column.propertyName, column);
		}
		const key = meta.primaryColumns.map((c) => referenceFor(c) ?? c.propertyName);
		const [onlyKey] = meta.primaryColumns;
		const generated =
			meta.primaryColumns.length === 1 &&
			onlyKey.isGenerated &&
			NUMBERED.has(onlyKey.generationStrategy ?? "")
				? onlyKey.propertyName
				: undefined;
		this.entityModel = {
			type: type as EntityClass,
			name: meta.name,
			key,
			fields,
			references,
			children: this.readChildren(),
			version: meta.versionColumn?.propertyName,
			generated,
			lazy,
		};
	}

	public get model(): EntityModel {
		return this.entityModel;
	}

	public get metadata(): EntityMetadata {
		return this.meta;
	}

	/** The column a field or reference is stored in, if it is mapped. */
	public columnOf(prop: string): ColumnMetadata | undefined {
		return this.columns.get(prop);
	}

	/** For a reference, the key property of the class it points at; otherwise undefined. */
	public targetKeyOf(prop: string): string | undefined {
		return this.targetKeys.get(prop);
	}

	private readReferences(): ReferenceModel[] {
		const { meta } = this;
		const relations = [...meta.manyToOneRelations, ...meta.ownerOneToOneRelations];
		return relations.map((relation) => {
			if (relation.joinColumns.length !== 1) {
				throw new DataConfigurationError(
					`${meta.name}.${relation.propertyName} references a composite key, which the unit of work can't track`,
				);
			}
			const [join] = relation.joinColumns;
			this.columns.set(relation.propertyName, join);
			this.targetKeys.set(relation.propertyName, join.referencedColumn?.propertyName ?? "id");
			return {
				prop: relation.propertyName,
				target: relation.inverseEntityMetadata.target as EntityClass,
				nullable: relation.isNullable,
				onDelete: relation.onDelete === "CASCADE" ? "cascade" : undefined,
			};
		});
	}

	private readChildren(): EntityModel["children"] {
		const { meta } = this;
		return meta.oneToManyRelations.map((relation) => {
			if (relation.persistenceEnabled) {
				throw new DataConfigurationError(
					`${meta.name}.${relation.propertyName}: map child collections with persistence: false; the unit of work writes them`,
				);
			}
			return {
				prop: relation.propertyName,
				target: relation.inverseEntityMetadata.target as EntityClass,
				parentRef: relation.inverseRelation?.propertyName,
			};
		});
	}
}
