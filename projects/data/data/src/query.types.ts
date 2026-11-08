import type { Children } from "./children.js";

/** A class the unit of work can load and track. Instances may be created without calling it. */
export type EntityClass<T extends object = object> = abstract new (...args: never[]) => T;

/** Properties holding an aggregate's child collections. */
export type ChildKeys<T> = {
	[K in keyof T]-?: NonNullable<T[K]> extends Children<unknown> ? K : never;
}[keyof T] &
	string;

/** Properties stored as columns or references: everything but methods and child collections. */
export type FieldKeys<T> = {
	[K in keyof T]-?: T[K] extends (...args: never[]) => unknown
		? never
		: NonNullable<T[K]> extends Children<unknown>
			? never
			: K;
}[keyof T] &
	string;

type ChildOf<T, K extends keyof T> = NonNullable<T[K]> extends Children<infer C> ? C : never;

/** A child collection to load with the root, or a nested one as a dotted path (`lines.parts`), up to three deep. */
export type Include<T, Depth extends unknown[] = []> = Depth["length"] extends 3
	? never
	: {
			[K in ChildKeys<T>]: K | `${K}.${Include<ChildOf<T, K>, [...Depth, unknown]>}`;
		}[ChildKeys<T>];

/** A condition on one field. A bare value or `null` means equal. */
export type Comparison<V> =
	| V
	| null
	| { in: readonly V[] }
	| { ne: V | null }
	| { gt: V }
	| { gte: V }
	| { lt: V }
	| { lte: V };

export type Where<T> = { [K in FieldKeys<T>]?: Comparison<NonNullable<T[K]>> };

export type OrderBy<T> = { [K in FieldKeys<T>]?: "asc" | "desc" };

/** A query in Decohere's own terms, so no ORM's options type reaches a repository. */
export type Query<T> = {
	where?: Where<T>;
	orderBy?: OrderBy<T>;
	limit?: number;
	include?: readonly Include<T>[];
	/** Lock the matched rows until commit (`SELECT … FOR UPDATE`). Starts the transaction if none is open. */
	lock?: "update";
};

/** A primary key: its fields, or the bare value when the key is one column. */
export type EntityKey<T> = { [K in FieldKeys<T>]?: T[K] } | string | number;
