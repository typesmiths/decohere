import type { ICache } from "../../src/caching/cache.js";
import { invalidateCache, memoize } from "../../src/caching/index.js";

class MockCache implements ICache {
	public get isMemoize(): boolean {
		return true;
	}

	private data = new Map<string, unknown>();

	public get(key: string): unknown {
		return this.data.get(key);
	}

	public set(key: string, value: unknown): void {
		this.data.set(key, value);
	}

	public has(key: string): boolean {
		return this.data.has(key);
	}

	public del(key: string): void {
		this.data.delete(key);
	}

	public flushAll(): void {
		this.data.clear();
	}
}

export const TEST_CACHE = new MockCache();

export class InvalidateCacheTestClass {
	public callCount = 0;

	@memoize({ cache: TEST_CACHE })
	public getValue(): string {
		this.callCount++;
		return `value_${this.callCount}`;
	}

	@invalidateCache("getValue", { cache: TEST_CACHE })
	public setValue(_value: string): void {
		// synchronous write — invalidation happens after this returns
	}

	@invalidateCache("getValue", { cache: TEST_CACHE })
	public async setValueAsync(_value: string): Promise<void> {
		// async write — invalidation happens after the promise resolves
	}
}
