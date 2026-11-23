import {
	comparison,
	type Comparison,
	DataConfigurationError,
	DataError,
	type EntityClass,
	type Row,
	type RowQuery,
} from "@decohere/data";
import { type MemoryEntity, memoryEntities } from "./memory-entity.js";

/**
 * Row locks, as Postgres takes them: a reference check takes `key-share` on the row it points at,
 * an update that keeps the key takes `no-key-update`, and a delete, a key change or
 * `lock: "update"` takes `update`. Each blocks only the modes Postgres says it conflicts with.
 */
type LockMode = "key-share" | "no-key-update" | "update";

const CONFLICTS: Record<LockMode, readonly LockMode[]> = {
	"key-share": ["update"],
	"no-key-update": ["no-key-update", "update"],
	update: ["key-share", "no-key-update", "update"],
};
const STRENGTH: Record<LockMode, number> = { "key-share": 0, "no-key-update": 1, update: 2 };

/** One transaction: its writes, kept apart until commit, and the row locks it holds. */
export class MemoryTransaction {
	/** Per class, by key: the row as this transaction wrote it, or null where it deleted one. */
	public readonly writes = new Map<EntityClass, Map<string, Row | null>>();
	public readonly held: { type: EntityClass; key: string }[] = [];
	/** The transactions holding locks this one waits for. */
	public waitingFor = new Set<MemoryTransaction>();
	/** The error that aborted it: after a failed statement, as in Postgres, it only rolls back. */
	public aborted: unknown;
	public finished = false;
	public readonly done: Promise<void>;
	private settle!: () => void;

	public constructor() {
		this.done = new Promise((resolve) => {
			this.settle = resolve;
		});
	}

	public finish() {
		this.finished = true;
		this.settle();
	}
}

/**
 * The rows of one data source, held in the process. Reads see what is committed plus their own
 * transaction's writes (read committed); a commit applies a transaction's writes in one step.
 * Rows are copied in and out, so an object held outside can't change what is stored.
 */
export class MemoryStore {
	private readonly models: Map<EntityClass, MemoryEntity>;
	private readonly tables = new Map<EntityClass, Map<string, Row>>();
	private readonly sequences = new Map<EntityClass, number>();
	private readonly locks = new Map<
		EntityClass,
		Map<string, Map<MemoryTransaction, LockMode>>
	>();

	public constructor(entities: readonly MemoryEntity[]) {
		this.models = memoryEntities.check(entities);
	}

	public model(type: EntityClass): MemoryEntity {
		const model = this.models.get(type);
		if (model == null) {
			throw new DataConfigurationError(
				`${type.name} isn't mapped: add mapEntity(${type.name}, …) to memory()'s entities`,
			);
		}
		return model;
	}

	public begin(): MemoryTransaction {
		return new MemoryTransaction();
	}

	public commit(tx: MemoryTransaction) {
		this.assertOpen(tx);
		if (tx.aborted !== undefined) {
			this.rollback(tx);
			throw new DataError(
				"The transaction was aborted by an earlier error, so it was rolled back",
				{
					cause: tx.aborted,
				},
			);
		}
		for (const [type, writes] of tx.writes) {
			const table = this.table(type);
			for (const [key, row] of writes) {
				if (row === null) table.delete(key);
				else table.set(key, row);
			}
		}
		this.end(tx);
	}

	public rollback(tx: MemoryTransaction) {
		this.assertOpen(tx);
		this.end(tx);
	}

	public select(tx: MemoryTransaction, type: EntityClass, query: RowQuery): Promise<Row[]> {
		return this.statement(tx, async () => {
			const model = this.model(type);
			for (const prop of Object.keys(query.where ?? {})) this.assertProp(model, prop);
			for (const prop of Object.keys(query.orderBy ?? {})) this.assertProp(model, prop);
			let found = this.query(tx, type, query);
			if (query.lock === "update") {
				// Lock what matched, then read again: a row another transaction changed while this one
				// waited is read as it now is, and dropped if it no longer matches.
				for (;;) {
					const unlocked = found.filter(([key]) => !this.holds(tx, type, key, "update"));
					if (unlocked.length === 0) break;
					for (const [key] of unlocked) await this.acquire(tx, type, key, "update");
					found = this.query(tx, type, query);
				}
			}
			const props = [...model.fields, ...model.references.map((r) => r.prop)];
			return found.map(([, row]) =>
				Object.fromEntries(props.map((prop) => [prop, copy(row[prop] ?? null)])),
			);
		});
	}

	public insert(tx: MemoryTransaction, type: EntityClass, rows: Row[]): Promise<Row[]> {
		return this.statement(tx, async () => {
			const generated: Row[] = [];
			for (const input of rows) generated.push(await this.insertRow(tx, type, input, "fail"));
			return generated;
		});
	}

	/** Insert one row unless its key is already kept, as `ON CONFLICT DO NOTHING` does: null when it was. */
	public insertIfAbsent(
		tx: MemoryTransaction,
		type: EntityClass,
		row: Row,
	): Promise<Row | null> {
		return this.statement(tx, () => this.insertRow(tx, type, row, "skip"));
	}

	public update(
		tx: MemoryTransaction,
		type: EntityClass,
		keyRow: Row,
		changes: Row,
		version?: { prop: string; expected: unknown },
	): Promise<number> {
		return this.statement(tx, async () => {
			const model = this.model(type);
			for (const prop of Object.keys(changes)) this.assertProp(model, prop);
			const key = this.keyOf(model, keyRow);
			const changesKey = model.key.some(
				(prop) => prop in changes && !equal(changes[prop], keyRow[prop]),
			);
			await this.acquire(tx, type, key, changesKey ? "update" : "no-key-update");
			const current = this.row(tx, type, key);
			if (current == null) return 0;
			if (version && !equal(current[version.prop], version.expected)) return 0;
			const next = { ...current, ...(copy(changes) as Row) };
			await this.checkReferences(tx, model, next, Object.keys(changes));
			if (!changesKey) {
				this.write(tx, type, key, next);
				return 1;
			}
			const nextKey = this.keyOf(model, next);
			await this.acquire(tx, type, nextKey, "update");
			if (this.row(tx, type, nextKey)) {
				throw new DataError(`${model.name} ${this.describe(model, next)} already exists`);
			}
			this.assertUnreferenced(tx, model, current);
			this.write(tx, type, key, null);
			this.write(tx, type, nextKey, next);
			return 1;
		});
	}

	public delete(tx: MemoryTransaction, type: EntityClass, keys: Row[]): Promise<void> {
		return this.statement(tx, async () => {
			const model = this.model(type);
			const deleted: { model: MemoryEntity; row: Row }[] = [];
			for (const keyRow of keys) {
				const key = this.keyOf(model, keyRow);
				await this.acquire(tx, type, key, "update");
				const row = this.row(tx, type, key);
				if (row == null) continue;
				this.write(tx, type, key, null);
				deleted.push({ model, row });
			}
			// Then what referenced them: cascaded where the reference says so, refused otherwise.
			for (let i = 0; i < deleted.length; i++) {
				const { model: parent, row } = deleted[i];
				for (const { child, ref, key, row: referencing } of this.referencing(
					tx,
					parent,
					row,
				)) {
					if (ref.onDelete !== "cascade") {
						throw new DataError(
							`Can't delete ${parent.name} ${this.describe(parent, row)}: ${child.name}.${ref.prop} still references it`,
						);
					}
					await this.acquire(tx, child.type, key, "update");
					if (this.row(tx, child.type, key) == null) continue;
					this.write(tx, child.type, key, null);
					deleted.push({ model: child, row: referencing });
				}
			}
		});
	}

	// ── Rows ───────────────────────────────────────────────────────────────

	/** One row inserted, returning the key it generated; a key already kept fails, or with "skip" returns null. */
	private async insertRow(
		tx: MemoryTransaction,
		type: EntityClass,
		input: Row,
		onConflict: "fail",
	): Promise<Row>;
	private async insertRow(
		tx: MemoryTransaction,
		type: EntityClass,
		input: Row,
		onConflict: "skip",
	): Promise<Row | null>;
	private async insertRow(
		tx: MemoryTransaction,
		type: EntityClass,
		input: Row,
		onConflict: "fail" | "skip",
	): Promise<Row | null> {
		const model = this.model(type);
		const row = copy(input) as Row;
		const out: Row = {};
		// A generated key is used up even when the insert then fails or is skipped, as a sequence is.
		if (model.generated && row[model.generated] == null) {
			const next = (this.sequences.get(type) ?? 0) + 1;
			this.sequences.set(type, next);
			row[model.generated] = next;
			out[model.generated] = next;
		}
		for (const prop of model.key) {
			if (row[prop] == null) throw new DataError(`${model.name}: key ${prop} is empty`);
		}
		await this.checkReferences(
			tx,
			model,
			row,
			model.references.map((r) => r.prop),
		);
		const key = this.keyOf(model, row);
		await this.acquire(tx, type, key, "update");
		if (this.row(tx, type, key)) {
			if (onConflict === "skip") return null;
			throw new DataError(`${model.name} ${this.describe(model, row)} already exists`);
		}
		this.write(tx, type, key, row);
		return out;
	}

	private query(tx: MemoryTransaction, type: EntityClass, query: RowQuery): [string, Row][] {
		const where = Object.entries(query.where ?? {});
		const found = [...this.rows(tx, type)].filter(([, row]) =>
			where.every(([prop, condition]) => matches(row[prop] ?? null, condition)),
		);
		const orderBy = Object.entries(query.orderBy ?? {});
		if (orderBy.length > 0) {
			found.sort(([, a], [, b]) => {
				for (const [prop, direction] of orderBy) {
					const order = sortOrder(a[prop] ?? null, b[prop] ?? null, direction);
					if (order !== 0) return order;
				}
				return 0;
			});
		}
		return query.limit === undefined ? found : found.slice(0, query.limit);
	}

	/** Every row as this transaction sees it: committed, then overlaid with its own writes. */
	private *rows(tx: MemoryTransaction, type: EntityClass): Iterable<[string, Row]> {
		const table = this.table(type);
		const writes = tx.writes.get(type);
		for (const [key, row] of table) {
			const written = writes?.get(key);
			if (written === undefined) yield [key, row];
			else if (written !== null) yield [key, written];
		}
		for (const [key, row] of writes ?? []) {
			if (row !== null && !table.has(key)) yield [key, row];
		}
	}

	private row(tx: MemoryTransaction, type: EntityClass, key: string): Row | undefined {
		const written = tx.writes.get(type)?.get(key);
		if (written !== undefined) return written ?? undefined;
		return this.table(type).get(key);
	}

	private write(tx: MemoryTransaction, type: EntityClass, key: string, row: Row | null) {
		let writes = tx.writes.get(type);
		if (writes == null) {
			writes = new Map();
			tx.writes.set(type, writes);
		}
		writes.set(key, row);
	}

	private table(type: EntityClass): Map<string, Row> {
		let table = this.tables.get(type);
		if (table == null) {
			table = new Map();
			this.tables.set(type, table);
		}
		return table;
	}

	/** A row's references, as a foreign key checks them: each set one points at a row that exists. */
	private async checkReferences(
		tx: MemoryTransaction,
		model: MemoryEntity,
		row: Row,
		props: string[],
	) {
		for (const ref of model.references) {
			if (!props.includes(ref.prop)) continue;
			const value = row[ref.prop];
			if (value == null) {
				if (ref.nullable) continue;
				throw new DataError(`${model.name}.${ref.prop} can't be empty`);
			}
			const target = this.model(ref.target);
			const key = this.keyOf(target, { [target.key[0]]: value });
			await this.acquire(tx, ref.target, key, "key-share");
			if (this.row(tx, ref.target, key) == null) {
				throw new DataError(
					`${model.name}.${ref.prop} references ${target.name} ${String(value)}, which doesn't exist`,
				);
			}
		}
	}

	private referencing(tx: MemoryTransaction, parent: MemoryEntity, row: Row) {
		const found: {
			child: MemoryEntity;
			ref: MemoryEntity["references"][number];
			key: string;
			row: Row;
		}[] = [];
		if (parent.key.length !== 1) return found;
		const value = row[parent.key[0]];
		for (const child of this.models.values()) {
			for (const ref of child.references) {
				if (ref.target !== parent.type) continue;
				for (const [key, candidate] of this.rows(tx, child.type)) {
					if (equal(candidate[ref.prop], value))
						found.push({ child, ref, key, row: candidate });
				}
			}
		}
		return found;
	}

	private assertUnreferenced(tx: MemoryTransaction, model: MemoryEntity, row: Row) {
		const [first] = this.referencing(tx, model, row);
		if (first) {
			throw new DataError(
				`Can't change the key of ${model.name} ${this.describe(model, row)}: ${first.child.name}.${first.ref.prop} references it`,
			);
		}
	}

	// ── Locks ──────────────────────────────────────────────────────────────

	/** Take a row lock, waiting while another transaction holds one that conflicts. */
	private async acquire(
		tx: MemoryTransaction,
		type: EntityClass,
		key: string,
		mode: LockMode,
	) {
		let byKey = this.locks.get(type);
		if (byKey == null) {
			byKey = new Map();
			this.locks.set(type, byKey);
		}
		for (;;) {
			let holders = byKey.get(key);
			if (holders == null) {
				holders = new Map();
				byKey.set(key, holders);
			}
			const blocking = [...holders]
				.filter(([other, held]) => other !== tx && CONFLICTS[mode].includes(held))
				.map(([other]) => other);
			if (blocking.length === 0) {
				const mine = holders.get(tx);
				if (mine == null) tx.held.push({ type, key });
				if (mine == null || STRENGTH[mode] > STRENGTH[mine]) holders.set(tx, mode);
				return;
			}
			tx.waitingFor = new Set(blocking);
			if (this.waitsOnItself(tx)) {
				tx.waitingFor = new Set();
				throw new DataError(
					`Deadlock: two transactions each wait for a row the other has locked (${this.model(type).name})`,
				);
			}
			await Promise.race(blocking.map((other) => other.done));
			tx.waitingFor = new Set();
		}
	}

	private holds(tx: MemoryTransaction, type: EntityClass, key: string, mode: LockMode) {
		const held = this.locks.get(type)?.get(key)?.get(tx);
		return held != null && STRENGTH[held] >= STRENGTH[mode];
	}

	private waitsOnItself(tx: MemoryTransaction): boolean {
		const seen = new Set<MemoryTransaction>();
		const visit = (other: MemoryTransaction): boolean => {
			if (other === tx) return true;
			if (seen.has(other)) return false;
			seen.add(other);
			return [...other.waitingFor].some(visit);
		};
		return [...tx.waitingFor].some(visit);
	}

	private end(tx: MemoryTransaction) {
		for (const { type, key } of tx.held) {
			const byKey = this.locks.get(type);
			const holders = byKey?.get(key);
			holders?.delete(tx);
			if (holders?.size === 0) byKey?.delete(key);
		}
		tx.finish();
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	/** Run one statement. A failure aborts the transaction, as in Postgres: it can only roll back. */
	private async statement<R>(tx: MemoryTransaction, run: () => Promise<R>): Promise<R> {
		this.assertOpen(tx);
		if (tx.aborted !== undefined) {
			throw new DataError("The transaction was aborted by an earlier error: roll it back", {
				cause: tx.aborted,
			});
		}
		try {
			return await run();
		} catch (err) {
			tx.aborted = err;
			throw err;
		}
	}

	private assertOpen(tx: MemoryTransaction) {
		if (tx.finished) throw new DataError("The transaction has ended");
	}

	private assertProp(model: MemoryEntity, prop: string) {
		if (!model.fields.includes(prop) && !model.references.some((r) => r.prop === prop)) {
			throw new DataConfigurationError(`${model.name} has no field "${prop}"`);
		}
	}

	/** A row's key as one string. Dates count by their instant. */
	private keyOf(model: MemoryEntity, row: Row): string {
		return JSON.stringify(
			model.key.map((prop) => {
				const value = row[prop];
				return value instanceof Date ? { date: value.getTime() } : value;
			}),
		);
	}

	private describe(model: MemoryEntity, row: Row): string {
		return model.key.map((prop) => String(row[prop])).join(", ");
	}
}

/** Whether a stored value meets a condition, with SQL's nulls: only `null` and `ne` match an empty value. */
function matches(value: unknown, condition: Comparison<unknown>): boolean {
	if (condition === null) return value === null;
	const operator = comparison.operatorOf(condition);
	if (!operator) return value !== null && equal(value, condition);
	const [op, operand] = operator;
	if (op === "ne" && operand === null) return value !== null;
	if (value === null) return false;
	if (op === "in") return (operand as unknown[]).some((v) => equal(value, v));
	if (op === "ne") return !equal(value, operand);
	if (operand === null) return false;
	const order = compare(value, operand);
	if (op === "gt") return order > 0;
	if (op === "gte") return order >= 0;
	if (op === "lt") return order < 0;
	return order <= 0;
}

/** Postgres's order: empty values last ascending, first descending. */
function sortOrder(a: unknown, b: unknown, direction: "asc" | "desc"): number {
	const sign = direction === "desc" ? -1 : 1;
	if (a === null || b === null) {
		if (a === b) return 0;
		return (a === null ? 1 : -1) * sign;
	}
	return compare(a, b) * sign;
}

function compare(a: unknown, b: unknown): number {
	const x = a instanceof Date ? a.getTime() : a;
	const y = b instanceof Date ? b.getTime() : b;
	const kind = typeof x;
	if (kind !== typeof y || !["number", "string", "bigint", "boolean"].includes(kind)) {
		throw new DataError(`Can't compare ${String(a)} with ${String(b)}`);
	}
	if ((x as number) < (y as number)) return -1;
	return (x as number) > (y as number) ? 1 : 0;
}

function equal(a: unknown, b: unknown): boolean {
	if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
	if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
		return JSON.stringify(a) === JSON.stringify(b);
	}
	return a === b;
}

function copy(value: unknown): unknown {
	return value !== null && typeof value === "object" ? structuredClone(value) : value;
}
