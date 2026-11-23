import {
	DataError,
	type EntityClass,
	type EntityModel,
	type Row,
	type RowQuery,
	type RowStore,
} from "@decohere/data";
import type { MemoryStore, MemoryTransaction } from "./memory.store.js";

/**
 * The memory provider's share of the unit of work: one transaction at a time on a
 * {@link MemoryStore}. Outside a transaction each operation runs in one of its own, as a database
 * runs a statement on its own.
 */
export class MemoryRowStore implements RowStore {
	private transaction: MemoryTransaction | undefined;

	public constructor(private readonly store: MemoryStore) {}

	public model(type: EntityClass): EntityModel {
		return this.store.model(type);
	}

	public async begin() {
		if (this.transaction) throw new DataError("A transaction is already open");
		this.transaction = this.store.begin();
	}

	public async commit() {
		this.store.commit(this.end());
	}

	public async rollback() {
		this.store.rollback(this.end());
	}

	public async release() {
		if (this.transaction) await this.rollback();
	}

	public inTransaction() {
		return this.transaction != null;
	}

	public select(type: EntityClass, query: RowQuery): Promise<Row[]> {
		return this.run((tx) => this.store.select(tx, type, query));
	}

	public insert(type: EntityClass, rows: Row[]): Promise<Row[]> {
		return this.run((tx) => this.store.insert(tx, type, rows));
	}

	public insertIfAbsent(type: EntityClass, row: Row): Promise<Row | null> {
		return this.run((tx) => this.store.insertIfAbsent(tx, type, row));
	}

	public update(
		type: EntityClass,
		key: Row,
		changes: Row,
		version?: { prop: string; expected: unknown },
	): Promise<number> {
		return this.run((tx) => this.store.update(tx, type, key, changes, version));
	}

	public delete(type: EntityClass, keys: Row[]): Promise<void> {
		return this.run((tx) => this.store.delete(tx, type, keys));
	}

	private end(): MemoryTransaction {
		const tx = this.transaction;
		if (tx == null) throw new DataError("No transaction is open");
		this.transaction = undefined;
		return tx;
	}

	private async run<R>(operation: (tx: MemoryTransaction) => Promise<R>): Promise<R> {
		if (this.transaction) return operation(this.transaction);
		const tx = this.store.begin();
		let result: R;
		try {
			result = await operation(tx);
		} catch (err) {
			this.store.rollback(tx);
			throw err;
		}
		this.store.commit(tx);
		return result;
	}
}
