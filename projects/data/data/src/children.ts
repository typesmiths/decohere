/** The children of an aggregate. MikroORM's `Collection` meets it; other providers load a {@link ChildList}. */
export interface Children<T> extends Iterable<T> {
	add(item: T): void;
	remove(item: T): void;
	readonly length: number;
}

/** Children for a new aggregate, and what a provider without collections of its own loads them into. */
export class ChildList<T> extends Array<T> implements Children<T> {
	// Array methods that build a new array (map, filter, slice) build a plain one.
	public static override get [Symbol.species]() {
		return Array;
	}

	public static of<T>(...items: T[]): ChildList<T> {
		const list = new ChildList<T>();
		for (const item of items) list.add(item);
		return list;
	}

	public add(item: T) {
		if (!this.includes(item)) this.push(item);
	}

	public remove(item: T) {
		const at = this.indexOf(item);
		if (at >= 0) this.splice(at, 1);
	}
}
