import {
	type ChildKeys,
	type ChildrenModel,
	DataConfigurationError,
	type EntityClass,
	type EntityModel,
	type FieldKeys,
	type ReferenceModel,
} from "@decohere/data";

/** A reference to another mapped class, stored as that class's key. */
export type MemoryReference<T> = {
	prop: FieldKeys<T>;
	target: EntityClass;
	/** Whether it may be empty. Defaults to false: a row can't be written without it. */
	nullable?: boolean;
	/** `"cascade"`: deleting the referenced row deletes this one, like `ON DELETE CASCADE`. Otherwise the delete fails while this row references it. */
	onDelete?: "cascade";
};

/** A child collection: the rows of `target` whose `parentRef` references this one. */
export type MemoryChildren<T> = {
	prop: ChildKeys<T>;
	target: EntityClass;
	/** The child's reference to its parent. */
	parentRef: string;
	/** The order children load in. Defaults to the child's key, ascending. */
	orderBy?: Record<string, "asc" | "desc">;
};

export type MemoryEntityOptions<T> = {
	/** The properties making the key: fields or references. Defaults to `["id"]`. */
	key?: FieldKeys<T>[];
	/** The properties stored as values. Key fields, the version and the generated key may be left out. */
	fields: FieldKeys<T>[];
	references?: MemoryReference<T>[];
	children?: MemoryChildren<T>[];
	/** A number checked and incremented on every update. */
	version?: FieldKeys<T>;
	/** A key field the store numbers 1, 2, 3… when an insert leaves it empty, like a serial column. */
	generated?: FieldKeys<T>;
	/** Fields loaded only when a query asks for them (`load`), like TypeORM's `select: false` or MikroORM's `lazy`. Listed in `fields` too. */
	lazy?: FieldKeys<T>[];
};

/** One class's mapping, as {@link mapEntity} makes it. */
export type MemoryEntity = EntityModel & {
	references: (ReferenceModel & { onDelete?: "cascade" })[];
	generated?: string;
};

/**
 * Map a class for the memory provider. With no ORM to read metadata from, the mapping is written
 * out: which properties are stored, which reference another class, and which hold children.
 */
export function mapEntity<T extends object>(
	type: EntityClass<T>,
	options: MemoryEntityOptions<T>,
): MemoryEntity {
	const key: string[] = options.key ?? ["id"];
	const references = (options.references ?? []).map((r) => ({
		prop: r.prop,
		target: r.target,
		nullable: r.nullable ?? false,
		onDelete: r.onDelete,
	}));
	const isReference = (prop: string) => references.some((r) => r.prop === prop);
	const fields = new Set<string>(options.fields);
	for (const prop of key) if (!isReference(prop)) fields.add(prop);
	if (options.version) fields.add(options.version);
	if (options.generated) fields.add(options.generated);
	return {
		type,
		name: type.name,
		key,
		fields: [...fields],
		references,
		children: (options.children ?? []).map((c): ChildrenModel => ({
			prop: c.prop,
			target: c.target,
			parentRef: c.parentRef,
			orderBy: c.orderBy,
		})),
		version: options.version,
		generated: options.generated,
		lazy: options.lazy ?? [],
	};
}

/**
 * Check the mappings fit together, so a mistake fails when the app is built rather than at the
 * first query: every key, reference and child names something mapped.
 */
function check(entities: readonly MemoryEntity[]): Map<EntityClass, MemoryEntity> {
	const byType = new Map<EntityClass, MemoryEntity>();
	for (const entity of entities) {
		if (byType.has(entity.type)) {
			throw new DataConfigurationError(`${entity.name} is mapped twice`);
		}
		byType.set(entity.type, entity);
	}
	const mapped = (owner: MemoryEntity, prop: string, target: EntityClass) => {
		const found = byType.get(target);
		if (found == null) {
			throw new DataConfigurationError(
				`${owner.name}.${prop} points at ${target.name}, which isn't mapped: add it to entities`,
			);
		}
		return found;
	};
	for (const entity of entities) {
		const { name } = entity;
		const isReference = (prop: string) => entity.references.some((r) => r.prop === prop);
		if (entity.key.length === 0) {
			throw new DataConfigurationError(`${name} has no key`);
		}
		if (entity.generated && (entity.key.length !== 1 || entity.key[0] !== entity.generated)) {
			throw new DataConfigurationError(
				`${name}.${entity.generated} is generated, so it must be the whole key`,
			);
		}
		for (const ref of entity.references) {
			if (entity.fields.includes(ref.prop)) {
				throw new DataConfigurationError(
					`${name}.${ref.prop} is both a field and a reference`,
				);
			}
			const target = mapped(entity, ref.prop, ref.target);
			if (target.key.length !== 1) {
				throw new DataConfigurationError(
					`${name}.${ref.prop} references ${target.name}, whose key is composite: a reference must point at a single key`,
				);
			}
		}
		for (const spec of entity.children) {
			const child = mapped(entity, spec.prop, spec.target);
			const parentRef = child.references.find((r) => r.prop === spec.parentRef);
			if (parentRef == null || parentRef.target !== entity.type) {
				throw new DataConfigurationError(
					`${name}.${spec.prop}: ${child.name}.${spec.parentRef} must be a reference to ${name}`,
				);
			}
		}
		for (const prop of entity.key) {
			if (!entity.fields.includes(prop) && !isReference(prop)) {
				throw new DataConfigurationError(`${name}'s key ${prop} isn't mapped`);
			}
		}
		for (const prop of entity.lazy ?? []) {
			if (
				!entity.fields.includes(prop) ||
				entity.key.includes(prop) ||
				prop === entity.version
			) {
				throw new DataConfigurationError(
					`${name}.${prop} is lazy, so it must be one of fields, and not the key or the version`,
				);
			}
		}
	}
	return byType;
}

export const memoryEntities = { check };
