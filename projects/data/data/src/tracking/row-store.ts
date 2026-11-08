import type { Comparison, EntityClass } from "../query.types.js";

/** One row, keyed by property name. A reference holds the referenced row's key value. */
export type Row = Record<string, unknown>;

export type ReferenceModel = {
	prop: string;
	target: EntityClass;
	/** Whether the column may be null, so the reference can be written after the insert to break a cycle. */
	nullable: boolean;
};

export type ChildrenModel = {
	prop: string;
	target: EntityClass;
	/** The child's reference to its parent. */
	parentRef: string;
	/** The order children load in. Defaults to the child's key, ascending. */
	orderBy?: Record<string, "asc" | "desc">;
};

/** What a provider tells the tracker about one mapped class. */
export type EntityModel = {
	type: EntityClass;
	name: string;
	/** The properties making the primary key: fields or references. */
	key: string[];
	/** Properties stored in a column of their own, keys and version included. References are not fields. */
	fields: string[];
	references: ReferenceModel[];
	children: ChildrenModel[];
	/** The field checked and incremented on every update. */
	version?: string;
};

/** A query on rows: fields and references compared with key values. */
export type RowQuery = {
	where?: Record<string, Comparison<unknown>>;
	orderBy?: Record<string, "asc" | "desc">;
	limit?: number;
	lock?: "update";
};

/**
 * What a provider supplies under {@link TrackingUnitOfWork}: the mapping, the transaction and
 * five row operations on one connection. Everything else is the tracker's.
 */
export interface RowStore {
	model(type: EntityClass): EntityModel;
	begin(): Promise<void>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
	/** Hand the connection back. Called once, when the unit of work is disposed. */
	release(): Promise<void>;
	inTransaction(): boolean;
	select(type: EntityClass, query: RowQuery): Promise<Row[]>;
	/** Insert the rows in one statement. Returns, for each row in order, the values the database generated. */
	insert(type: EntityClass, rows: Row[]): Promise<Row[]>;
	/** `UPDATE … SET changes WHERE key (AND version = expected)`. Returns the number of rows changed. */
	update(
		type: EntityClass,
		key: Row,
		changes: Row,
		version?: { prop: string; expected: unknown },
	): Promise<number>;
	delete(type: EntityClass, keys: Row[]): Promise<void>;
}
