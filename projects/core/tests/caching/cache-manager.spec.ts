import { afterEach, describe, expect, it } from "vitest";
import type { ICache } from "../../src/caching/cache.js";
import { Caching } from "../../src/caching/cache-manager.js";

// Simple cache implementation for testing
class TestCache implements ICache {
	public get isMemoize(): boolean {
		throw new Error("Method not implemented.");
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

describe("Caching manager", () => {
	afterEach(() => {
		Caching.flushAllCaches();
	});

	describe("setCache and getCache", () => {
		it("should set and get a named cache instance", () => {
			const testCache = new TestCache();
			Caching.setCache("TEST_CACHE", testCache);

			const retrieved = Caching.getCache("TEST_CACHE");
			expect(retrieved).toBe(testCache);
		});

		it("should create default cache if not set", () => {
			const defaultCache = Caching.getCache();
			expect(defaultCache).toBeDefined();

			// Should return the same instance on subsequent calls
			const defaultCache2 = Caching.getCache();
			expect(defaultCache2).toBe(defaultCache);
		});

		it("should create default cache when getting by 'DEFAULT' name", () => {
			const defaultCache = Caching.getCache("DEFAULT");
			expect(defaultCache).toBeDefined();

			const defaultCache2 = Caching.getCache();
			expect(defaultCache2).toBe(defaultCache);
		});

		it("should maintain separate cache instances for different names", () => {
			const cache1 = new TestCache();
			const cache2 = new TestCache();

			Caching.setCache("CACHE_1", cache1);
			Caching.setCache("CACHE_2", cache2);

			expect(Caching.getCache("CACHE_1")).toBe(cache1);
			expect(Caching.getCache("CACHE_2")).toBe(cache2);
			expect(Caching.getCache("CACHE_1")).not.toBe(cache2);
		});
	});

	describe("hasCache", () => {
		it("should return true for existing cache", () => {
			const testCache = new TestCache();
			Caching.setCache("TEST_CACHE", testCache);

			expect(Caching.hasCache("TEST_CACHE")).toBe(true);
		});

		it("should return false for non-existing cache", () => {
			expect(Caching.hasCache("NON_EXISTENT")).toBe(false);
		});

		it("should return true for default cache after first access", () => {
			Caching.getCache(); // This creates the default cache
			expect(Caching.hasCache("DEFAULT")).toBe(true);
		});
	});

	describe("clear", () => {
		it("should clear a named cache if it has a clear method", () => {
			const testCache = new TestCache();
			Caching.setCache("TEST_CACHE", testCache);

			const cache = Caching.getCache("TEST_CACHE");
			cache.set("key1", "value1");
			expect(cache.get("key1")).toBe("value1");

			Caching.flushAllCaches();
			expect(cache.get("key1")).toBeUndefined();
		});

		it("should clear default cache when no name is provided", () => {
			const cache = Caching.getCache();
			cache.set("key1", "value1");
			expect(cache.get("key1")).toBe("value1");

			Caching.flushAllCaches();
			expect(cache.get("key1")).toBeUndefined();
		});
	});

	describe("removeCache", () => {
		it("should remove a cache instance", () => {
			const testCache = new TestCache();
			Caching.setCache("TEST_CACHE", testCache);

			expect(Caching.hasCache("TEST_CACHE")).toBe(true);

			Caching.removeCache("TEST_CACHE");
			expect(Caching.hasCache("TEST_CACHE")).toBe(false);
		});

		it("should not throw error when removing non-existent cache", () => {
			expect(() => Caching.removeCache("NON_EXISTENT")).not.toThrow();
		});

		it("should allow re-adding cache after removal", () => {
			const testCache1 = new TestCache();
			const testCache2 = new TestCache();

			Caching.setCache("TEST_CACHE", testCache1);
			expect(Caching.getCache("TEST_CACHE")).toBe(testCache1);

			Caching.removeCache("TEST_CACHE");
			expect(Caching.hasCache("TEST_CACHE")).toBe(false);

			Caching.setCache("TEST_CACHE", testCache2);
			expect(Caching.getCache("TEST_CACHE")).toBe(testCache2);
		});
	});
});
