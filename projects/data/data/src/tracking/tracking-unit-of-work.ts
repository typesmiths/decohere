// Change tracking for providers without a unit of work of their own. Its behaviour follows
// MikroORM's unit of work, which is the reference: an identity map, a snapshot on load, a diff
// on commit, writes ordered by references, one transaction. Written from scratch.
import { ChildList } from "../children.js";
import { comparison } from "../comparison.js";
import { domainEvents, type OutboxMapper } from "../domain-event.js";
import { DataError, OptimisticLockError } from "../error.js";
import type { Comparison, EntityClass, EntityKey, Include, Query } from "../query.types.js";
import type { IUnitOfWork } from "../unit-of-work.js";
import type { ChildrenModel, EntityModel, Row, RowQuery, RowStore } from "./row-store.js";

type Snapshot = { values: Row; children: Map<string, object[]> };

type Plan = {
	inserts: object[];
	updates: { entity: object; changes: Row }[];
	deletes: object[];
};

export type TrackingUnitOfWorkOptions = {
	/** Writes the events aggregates raise to an outbox table in the same commit. */
	outbox?: OutboxMapper;
};

/** Stands in for a child collection that wasn't loaded, so using it fails loudly instead of looking empty. */
class UnloadedChildren {
	public constructor(private readonly where: string) {}
	public get length(): number {
		return this.fail();
	}
	public add(): void {
		this.fail();
	}
	public remove(): void {
		this.fail();
	}
	public [Symbol.iterator](): Iterator<never> {
		return this.fail();
	}
	public toJSON() {
		return undefined;
	}
	private fail(): never {
		throw new DataError(`${this.where} wasn't loaded: include it in the query`);
	}
}

export class TrackingUnitOfWork implements IUnitOfWork {
	/** Per class, by key: every instance this unit of work knows, loaded or only referenced. */
	private readonly identity = new Map<EntityClass, Map<string, object>>();
	/** Loaded instances and what they held when loaded or last committed. */
	private readonly snapshots = new WeakMap<object, Snapshot>();
	private readonly added = new Set<object>();
	private readonly removed = new Set<object>();
	private failure: unknown;
	private released = false;

	public constructor(
		private readonly store: RowStore,
		private readonly options: TrackingUnitOfWorkOptions = {},
	) {}

	public async findById<T extends object>(
		type: EntityClass<T>,
		key: EntityKey<T>,
		include: readonly Include<T>[] = [],
	): Promise<T | null> {
		this.assertUsable();
		const model = this.store.model(type);
		const where = this.keyWhere(model, key);
		const hit = this.identity.get(type)?.get(this.keyOf(model, where));
		const snapshot = hit && this.snapshots.get(hit);
		if (snapshot && include.every((path) => this.isLoaded(type, [hit], path))) return hit as T;
		return this.findOne(type, { where, include } as Query<T>);
	}

	public async findOne<T extends object>(type: EntityClass<T>, query: Query<T> = {}) {
		const [found] = await this.find(type, { ...query, limit: 1 });
		return found ?? null;
	}

	public async find<T extends object>(
		type: EntityClass<T>,
		query: Query<T> = {},
	): Promise<T[]> {
		this.assertUsable();
		if (query.lock && !this.store.inTransaction()) await this.store.begin();
		const model = this.store.model(type);
		const rows = await this.store.select(type, {
			where: this.rowWhere(model, query.where ?? {}),
			orderBy: query.orderBy,
			limit: query.limit,
			lock: query.lock,
		});
		const roots = rows.map((row) => this.hydrate(model, row)) as T[];
		for (const path of query.include ?? []) await this.loadPath(type, roots, path);
		return roots;
	}

	public add(entity: object) {
		this.assertUsable();
		if (this.removed.delete(entity)) return;
		if (!this.snapshots.has(entity)) this.added.add(entity);
	}

	public remove(entity: object) {
		this.assertUsable();
		if (this.added.delete(entity)) return;
		this.removed.add(entity);
	}

	public async beginTransaction() {
		this.assertUsable();
		if (!this.store.inTransaction()) await this.store.begin();
	}

	public async commit() {
		this.assertUsable();
		let plan: Plan;
		try {
			plan = await this.plan();
			const empty = plan.inserts.length + plan.updates.length + plan.deletes.length === 0;
			if (empty && !this.store.inTransaction()) return;
			if (!this.store.inTransaction()) await this.store.begin();
			await this.write(plan);
			await this.store.commit();
		} catch (err) {
			this.failure = err;
			if (this.store.inTransaction()) {
				try {
					await this.store.rollback();
				} catch (rollbackError) {
					throw new AggregateError(
						[err, rollbackError],
						"Commit failed, and so did the rollback",
					);
				}
			}
			throw err;
		}
		this.afterCommit(plan);
	}

	public async [Symbol.asyncDispose]() {
		if (this.released) return;
		this.released = true;
		try {
			if (this.store.inTransaction()) await this.store.rollback();
		} finally {
			await this.store.release();
		}
	}

	// ── Loading ────────────────────────────────────────────────────────────

	/** The instance for a row: the one already known for its key, or a new one. Known instances keep their changes. */
	private hydrate(model: EntityModel, row: Row): object {
		const key = this.keyOf(model, row);
		const known = this.instances(model.type).get(key);
		if (known && this.snapshots.has(known)) return known;
		const entity = known ?? Object.create(model.type.prototype);
		for (const field of model.fields) entity[field] = row[field];
		for (const ref of model.references) {
			const value = row[ref.prop];
			entity[ref.prop] = value == null ? null : this.reference(ref.target, value);
		}
		for (const spec of model.children) {
			entity[spec.prop] = new UnloadedChildren(`${model.name}.${spec.prop}`);
		}
		this.instances(model.type).set(key, entity);
		this.snapshots.set(entity, { values: this.values(model, entity), children: new Map() });
		return entity;
	}

	/** The instance for a referenced key: known already, or a reference holding only its key until it is loaded. */
	private reference(type: EntityClass, keyValue: unknown): object {
		const model = this.store.model(type);
		const field = this.singleKey(model);
		const key = String(keyValue);
		const known = this.instances(type).get(key);
		if (known) return known;
		const ref = Object.create(type.prototype);
		const target = model.references.find((r) => r.prop === field);
		ref[field] = target ? this.reference(target.target, keyValue) : keyValue;
		this.instances(type).set(key, ref);
		return ref;
	}

	private isLoaded(type: EntityClass, roots: object[], path: string): boolean {
		const [prop, ...rest] = path.split(".");
		const spec = this.childSpec(this.store.model(type), prop);
		const children: object[] = [];
		for (const root of roots) {
			const loaded = this.snapshots.get(root)?.children.get(prop);
			if (!loaded) return false;
			children.push(...(root[prop] as Iterable<object>));
		}
		return rest.length === 0 || this.isLoaded(spec.target, children, rest.join("."));
	}

	private async loadPath(type: EntityClass, roots: object[], path: string) {
		const [prop, ...rest] = path.split(".");
		const model = this.store.model(type);
		const spec = this.childSpec(model, prop);
		await this.loadChildren(model, spec, roots);
		if (rest.length === 0) return;
		const children = roots.flatMap((root) => [...(root[prop] as Iterable<object>)]);
		if (children.length > 0) await this.loadPath(spec.target, children, rest.join("."));
	}

	private async loadChildren(model: EntityModel, spec: ChildrenModel, roots: object[]) {
		const pending = roots.filter((root) => !this.snapshots.get(root)?.children.has(spec.prop));
		if (pending.length === 0) return;
		const childModel = this.store.model(spec.target);
		const parentKeys = pending.map((root) => this.keyValue(model, root));
		const rows = await this.store.select(spec.target, {
			where: { [spec.parentRef]: { in: parentKeys } },
			orderBy:
				spec.orderBy ?? Object.fromEntries(childModel.key.map((k) => [k, "asc" as const])),
		});
		const lists = new Map(pending.map((root) => [root, new ChildList<object>()]));
		for (const row of rows) {
			const child = this.hydrate(childModel, row);
			const parent = child[spec.parentRef] as object;
			lists.get(parent)?.add(child);
		}
		for (const [root, list] of lists) {
			root[spec.prop] = list;
			this.snapshots.get(root)?.children.set(spec.prop, [...list]);
		}
	}

	// ── Committing ─────────────────────────────────────────────────────────

	private async plan(): Promise<Plan> {
		const managed = this.managed();
		if (this.options.outbox) {
			for (const row of domainEvents.collect(
				[...managed, ...this.added],
				this.options.outbox,
			)) {
				this.added.add(row);
			}
		}

		const inserts = new Set<object>();
		const deletes = new Set<object>();
		const persist = (entity: object) => {
			if (this.snapshots.has(entity) || inserts.has(entity)) return;
			inserts.add(entity);
			const model = this.store.model(entity.constructor as EntityClass);
			for (const ref of model.references) {
				const target = entity[ref.prop];
				if (
					target &&
					typeof target === "object" &&
					!this.isKnown(target) &&
					!this.removed.has(target)
				) {
					persist(target);
				}
			}
			for (const spec of model.children) {
				const children = entity[spec.prop];
				if (!children || children instanceof UnloadedChildren) continue;
				for (const child of children as Iterable<object>) {
					child[spec.parentRef] = entity;
					persist(child);
				}
			}
		};
		// Children it loaded go first. Children it didn't load are the database's to cascade, as with
		// MikroORM: a remove never loads more rows.
		const remove = (entity: object) => {
			if (deletes.has(entity) || inserts.has(entity)) return;
			deletes.add(entity);
			for (const children of this.snapshots.get(entity)?.children.values() ?? []) {
				for (const child of children) remove(child);
			}
		};

		for (const entity of this.added) persist(entity);

		// Children added, moved or dropped inside aggregates already loaded.
		const claimed = new Set<object>();
		const dropped: object[] = [];
		for (const entity of managed) {
			if (this.removed.has(entity)) continue;
			const model = this.store.model(entity.constructor as EntityClass);
			const snapshot = this.snapshots.get(entity);
			for (const [prop, before] of snapshot?.children ?? []) {
				const spec = this.childSpec(model, prop);
				const after = [...(entity[prop] as Iterable<object>)];
				for (const child of after) {
					claimed.add(child);
					child[spec.parentRef] = entity;
					persist(child);
				}
				for (const child of before) if (!after.includes(child)) dropped.push(child);
			}
		}
		for (const child of dropped) if (!claimed.has(child)) remove(child);
		for (const entity of this.removed) remove(entity);

		const updates: Plan["updates"] = [];
		for (const entity of this.managed()) {
			if (deletes.has(entity)) continue;
			const model = this.store.model(entity.constructor as EntityClass);
			const before = this.snapshots.get(entity)?.values ?? {};
			const now = this.values(model, entity);
			const changes: Row = {};
			for (const [prop, value] of Object.entries(now)) {
				if (prop !== model.version && !same(value, before[prop])) changes[prop] = value;
			}
			if (Object.keys(changes).length > 0) updates.push({ entity, changes });
		}
		return { inserts: [...inserts], updates, deletes: [...deletes] };
	}

	private async write(plan: Plan) {
		const order = this.commitOrder([
			...plan.inserts,
			...plan.updates.map((u) => u.entity),
			...plan.deletes,
		]);
		const rank = (entity: object) => order.indexOf(entity.constructor as EntityClass);

		// Inserts in waves: a row goes once every row it references has its key. In a cycle, a
		// nullable reference is inserted as null and written after the inserts, as MikroORM does.
		const pending = new Set(plan.inserts);
		const deferred: { entity: object; prop: string }[] = [];
		const ready = (entity: object) =>
			this.store.model(entity.constructor as EntityClass).references.every((ref) => {
				const target = entity[ref.prop];
				return (
					!target ||
					!pending.has(target) ||
					deferred.some((d) => d.entity === entity && d.prop === ref.prop)
				);
			});
		while (pending.size > 0) {
			let wrote = false;
			for (const type of order) {
				const batch = [...pending].filter((e) => e.constructor === type && ready(e));
				if (batch.length === 0) continue;
				await this.insert(type, batch, deferred);
				for (const e of batch) pending.delete(e);
				wrote = true;
			}
			if (wrote) continue;
			const breakable = [...pending].flatMap((entity) =>
				this.store
					.model(entity.constructor as EntityClass)
					.references.filter((ref) => ref.nullable && pending.has(entity[ref.prop]))
					.map((ref) => ({ entity, prop: ref.prop })),
			);
			if (breakable.length === 0) {
				const names = [...new Set([...pending].map((e) => e.constructor.name))].join(", ");
				throw new DataError(
					`Can't order the inserts: required references form a cycle (${names})`,
				);
			}
			deferred.push(breakable[0]);
		}
		for (const { entity, prop } of deferred) {
			const model = this.store.model(entity.constructor as EntityClass);
			const target = this.store.model(entity[prop].constructor as EntityClass);
			// The version stays as it is: this finishes the insert rather than changing the row.
			const version = model.version ? { [model.version]: entity[model.version] } : {};
			await this.store.update(model.type, this.keyRow(model, entity), {
				[prop]: this.keyValue(target, entity[prop]),
				...version,
			});
		}

		for (const { entity, changes } of [...plan.updates].sort(
			(a, b) => rank(a.entity) - rank(b.entity),
		)) {
			const model = this.store.model(entity.constructor as EntityClass);
			const before = this.snapshots.get(entity)?.values ?? {};
			const key = Object.fromEntries(model.key.map((k) => [k, before[k]]));
			if (!model.version) {
				await this.store.update(model.type, key, changes);
				continue;
			}
			const expected = entity[model.version] as number;
			const affected = await this.store.update(
				model.type,
				key,
				{ ...changes, [model.version]: expected + 1 },
				{ prop: model.version, expected },
			);
			if (affected === 0) {
				throw new OptimisticLockError(
					`${model.name} ${this.keyOf(model, entity)} changed since it was loaded`,
				);
			}
			entity[model.version] = expected + 1;
		}

		for (const type of [...order].reverse()) {
			const batch = plan.deletes.filter((e) => e.constructor === type);
			if (batch.length === 0) continue;
			const model = this.store.model(type);
			await this.store.delete(
				type,
				batch.map((e) => this.keyRow(model, e)),
			);
		}
	}

	private async insert(
		type: EntityClass,
		batch: object[],
		deferred: { entity: object; prop: string }[],
	) {
		const model = this.store.model(type);
		const rows = batch.map((entity) => {
			if (model.version && entity[model.version] == null) entity[model.version] = 1;
			const row: Row = {};
			for (const field of model.fields)
				if (entity[field] !== undefined) row[field] = entity[field];
			for (const ref of model.references) {
				const target = entity[ref.prop];
				const skip = deferred.some((d) => d.entity === entity && d.prop === ref.prop);
				row[ref.prop] =
					target == null || skip
						? null
						: this.keyValue(this.store.model(target.constructor as EntityClass), target);
			}
			return row;
		});
		const generated = await this.store.insert(type, rows);
		batch.forEach((entity, i) => Object.assign(entity, generated[i]));
	}

	private afterCommit(plan: Plan) {
		for (const entity of plan.deletes) {
			const model = this.store.model(entity.constructor as EntityClass);
			const before = this.snapshots.get(entity)?.values;
			this.instances(model.type).delete(this.keyOf(model, before ?? entity));
			this.snapshots.delete(entity);
		}
		for (const entity of [...this.managed(), ...plan.inserts]) {
			const model = this.store.model(entity.constructor as EntityClass);
			const before = this.snapshots.get(entity)?.values;
			if (before) this.instances(model.type).delete(this.keyOf(model, before));
			this.instances(model.type).set(this.keyOf(model, entity), entity);
			const children = new Map<string, object[]>();
			for (const spec of model.children) {
				const list = entity[spec.prop];
				if (list && !(list instanceof UnloadedChildren))
					children.set(spec.prop, [...(list as Iterable<object>)]);
			}
			this.snapshots.set(entity, { values: this.values(model, entity), children });
		}
		this.added.clear();
		this.removed.clear();
	}

	/** Classes in commit order: a class comes after every class it references. */
	private commitOrder(entities: object[]): EntityClass[] {
		const types = [...new Set(entities.map((e) => e.constructor as EntityClass))];
		const sorted: EntityClass[] = [];
		const visit = (type: EntityClass, path: Set<EntityClass>) => {
			if (sorted.includes(type) || path.has(type)) return;
			path.add(type);
			for (const ref of this.store.model(type).references) {
				if (types.includes(ref.target)) visit(ref.target, path);
			}
			path.delete(type);
			sorted.push(type);
		};
		for (const type of types) visit(type, new Set());
		return sorted;
	}

	// ── Keys and values ────────────────────────────────────────────────────

	private managed(): object[] {
		return [...this.identity.values()].flatMap((byKey) =>
			[...byKey.values()].filter((e) => this.snapshots.has(e)),
		);
	}

	private isKnown(entity: object): boolean {
		const model = this.store.model(entity.constructor as EntityClass);
		const key = model.key.every((k) => entity[k] != null)
			? this.keyOf(model, entity)
			: undefined;
		return key !== undefined && this.instances(model.type).get(key) === entity;
	}

	private instances(type: EntityClass): Map<string, object> {
		let byKey = this.identity.get(type);
		if (!byKey) {
			byKey = new Map();
			this.identity.set(type, byKey);
		}
		return byKey;
	}

	/** Fields as stored, references as the referenced key. */
	private values(model: EntityModel, entity: object): Row {
		const values: Row = {};
		for (const field of model.fields) values[field] = clone(entity[field]);
		for (const ref of model.references) {
			const target = entity[ref.prop];
			values[ref.prop] =
				target == null ? null : this.keyValue(this.store.model(ref.target), target);
		}
		return values;
	}

	/** The key as one string, from an entity or a row. */
	private keyOf(model: EntityModel, source: object): string {
		return model.key
			.map((k) => {
				const value = source[k];
				const ref = model.references.find((r) => r.prop === k);
				if (ref && value && typeof value === "object" && !(value instanceof Date)) {
					return String(this.keyValue(this.store.model(ref.target), value));
				}
				return String(value);
			})
			.join("\u0000");
	}

	/** The single value a reference to this entity stores. */
	private keyValue(model: EntityModel, entity: object): unknown {
		const field = this.singleKey(model);
		const value = entity[field];
		const ref = model.references.find((r) => r.prop === field);
		return ref && value && typeof value === "object"
			? this.keyValue(this.store.model(ref.target), value)
			: value;
	}

	private keyRow(model: EntityModel, entity: object): Row {
		const values = this.values(model, entity);
		return Object.fromEntries(model.key.map((k) => [k, values[k]]));
	}

	private keyWhere(model: EntityModel, key: unknown): Row {
		if (key !== null && typeof key === "object") return key as Row;
		return { [this.singleKey(model)]: key };
	}

	private singleKey(model: EntityModel): string {
		if (model.key.length !== 1) {
			throw new DataError(
				`${model.name} has a composite key: reference it, or find it, by all of ${model.key.join(", ")}`,
			);
		}
		return model.key[0];
	}

	/** A query's conditions, with entities in it replaced by their keys. */
	private rowWhere(model: EntityModel, where: Record<string, unknown>): RowQuery["where"] {
		const toKey = (value: unknown) => {
			if (value === null || typeof value !== "object" || value instanceof Date) return value;
			return this.keyValue(this.store.model(value.constructor as EntityClass), value);
		};
		return Object.fromEntries(
			Object.entries(where).map(([prop, condition]) => {
				if (!model.references.some((r) => r.prop === prop)) return [prop, condition];
				if (condition === null) return [prop, null];
				const operator = comparison.operatorOf(condition);
				if (!operator) return [prop, toKey(condition)];
				const [op, operand] = operator;
				return [
					prop,
					{
						[op]: op === "in" ? (operand as unknown[]).map(toKey) : toKey(operand),
					} as Comparison<unknown>,
				];
			}),
		);
	}

	private childSpec(model: EntityModel, prop: string): ChildrenModel {
		const spec = model.children.find((c) => c.prop === prop);
		if (!spec) throw new DataError(`${model.name} has no child collection "${prop}"`);
		return spec;
	}

	private assertUsable() {
		if (this.released) throw new DataError("This unit of work was disposed");
		if (this.failure !== undefined) {
			throw new DataError(
				"A commit failed in this unit of work, so it was rolled back: start a new one",
				{
					cause: this.failure,
				},
			);
		}
	}
}

function clone(value: unknown): unknown {
	if (value instanceof Date) return new Date(value.getTime());
	if (value !== null && typeof value === "object") return structuredClone(value);
	return value;
}

function same(a: unknown, b: unknown): boolean {
	if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
	if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
		return JSON.stringify(a) === JSON.stringify(b);
	}
	return a === b;
}
