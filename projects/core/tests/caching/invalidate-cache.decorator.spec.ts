import { afterEach, describe, expect, it } from "vitest";
import type { ICache } from "../../src/caching/cache.js";
import { Caching } from "../../src/caching/cache-manager.js";
import { invalidateCache, invalidateMemoize, memoize } from "../../src/caching/index.js";

class TestCache implements ICache {
	public get isMemoize() {
		return true;
	}
	private data = new Map<string, unknown>();
	public get(key: string) {
		return this.data.get(key);
	}
	public set(key: string, value: unknown) {
		this.data.set(key, value);
	}
	public has(key: string) {
		return this.data.has(key);
	}
	public del(key: string) {
		this.data.delete(key);
	}
	public flushAll() {
		this.data.clear();
	}
}

const TEST_CACHE = new TestCache();

// Function reference: apply invalidateCache after class definition so the prototype is available
class MemoizedClass {
	public callCount = 0;

	@memoize({ cache: TEST_CACHE })
	public getValue(): string {
		this.callCount++;
		return `value_${this.callCount}`;
	}

	public invalidate(): void {}
	public async invalidateAsync(): Promise<void> {}
}

for (const key of ["invalidate", "invalidateAsync"] as const) {
	const desc = Object.getOwnPropertyDescriptor(MemoizedClass.prototype, key)!;
	invalidateMemoize(MemoizedClass.prototype.getValue, { cache: TEST_CACHE })(
		MemoizedClass.prototype,
		key,
		desc,
	);
	Object.defineProperty(MemoizedClass.prototype, key, desc);
}

// String overload: raw cache key eviction (no generateCacheKey semantics)
class RawKeyClass {
	@invalidateCache("myRawKey", { cache: TEST_CACHE })
	public clearEntry(): void {}
}

describe("invalidateCache decorator", () => {
	afterEach(() => {
		TEST_CACHE.flushAll();
		Caching.flushAllCaches();
	});

	describe("function reference", () => {
		it("should evict cache for the referenced method after synchronous invalidator runs", () => {
			const instance = new MemoizedClass();

			instance.getValue(); // callCount = 1, cached
			instance.getValue(); // from cache
			expect(instance.callCount).toBe(1);

			instance.invalidate();

			instance.getValue(); // evicted — re-executes
			expect(instance.callCount).toBe(2);
		});

		it("should evict cache for the referenced method after async invalidator resolves", async () => {
			const instance = new MemoizedClass();

			instance.getValue(); // callCount = 1, cached
			instance.getValue(); // from cache
			expect(instance.callCount).toBe(1);

			await instance.invalidateAsync();

			instance.getValue(); // evicted — re-executes
			expect(instance.callCount).toBe(2);
		});

		it("should use the custom cache supplied via options", () => {
			const instance = new MemoizedClass();

			instance.getValue(); // callCount = 1, cached in TEST_CACHE
			expect(instance.callCount).toBe(1);

			instance.invalidate(); // evicts TEST_CACHE entry

			instance.getValue(); // callCount = 2
			expect(instance.callCount).toBe(2);

			TEST_CACHE.flushAll();
			instance.getValue(); // callCount = 3
			expect(instance.callCount).toBe(3);
		});
	});

	describe("string (raw cache key)", () => {
		it("should delete the exact cache key when passed a string", () => {
			TEST_CACHE.set("myRawKey", "someValue");
			expect(TEST_CACHE.has("myRawKey")).toBe(true);

			new RawKeyClass().clearEntry();

			expect(TEST_CACHE.has("myRawKey")).toBe(false);
		});
	});
});
