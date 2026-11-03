import type { ICache } from "./cache.js";

type MapCacheOptions = {
	/** Hand out the stored reference instead of a copy (what `@memoize` needs). */
	memoize?: boolean;
};

/**
 * The built-in cache: a plain `Map`, no expiry.
 *
 * By default `get` returns a `structuredClone` of an object, so a caller that changes what it
 * got back can't change the cached value. With `memoize` it returns the stored reference.
 * Scalars, `null` and `undefined` are returned as they are.
 */
export class MapCache implements ICache {
	readonly #entries = new Map<string, unknown>();
	readonly #memoize: boolean;

	public constructor(options: MapCacheOptions = {}) {
		this.#memoize = options.memoize ?? false;
	}

	public get isMemoize(): boolean {
		return this.#memoize;
	}

	public get(key: string): unknown {
		const value = this.#entries.get(key);
		if (this.#memoize || value === null || typeof value !== "object") {
			return value;
		}
		return structuredClone(value);
	}

	public set(key: string, value: unknown): void {
		this.#entries.set(key, value);
	}

	public has(key: string): boolean {
		return this.#entries.has(key);
	}

	public del(key: string): void {
		this.#entries.delete(key);
	}

	public flushAll(): void {
		this.#entries.clear();
	}
}
