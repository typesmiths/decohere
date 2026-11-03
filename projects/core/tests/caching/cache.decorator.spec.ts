import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Caching } from "../../src/caching/cache-manager.js";
import { pathToFileUrl } from "../../src/io/url-to-path.js";
import { CACHE } from "./cache-test-class.js";

// Test class import path constant
const CACHE_TEST_CLASS_PATH = "./cache-test-class.js";

// Function-based import URL for easier refactoring
const importUrl = () => getImportUrl(CACHE_TEST_CLASS_PATH);

// Set up the test cache in Caching manager
Caching.setCache("TEST_CACHE", CACHE);

// Helper function to create a versioned import URL for cache busting
function getImportUrl(filename: string): string {
	const modulePath = path.resolve(__dirname, filename);
	const moduleUrl = pathToFileUrl(modulePath);
	return `${moduleUrl}?version=${Date.now()}`;
}

describe("cache decorator", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		Caching.flushAllCaches();
		CACHE.flushAll();
		delete process.env.FORGE_DISABLE_CACHE;
	});

	describe("FORGE_DISABLE_CACHE environment variable behavior", () => {
		it("should cache normally by default", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = instance.syncMethod(5);
			const result2 = instance.syncMethod(5);

			expect(result1).toBe(10);
			expect(result2).toBe(10);
			expect(instance.callCount).toBe(1); // Should be cached
		});

		it("should disable caching when FORGE_DISABLE_CACHE=true", async () => {
			process.env.FORGE_DISABLE_CACHE = "true";

			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = instance.syncMethod(5);
			const result2 = instance.syncMethod(5);

			expect(result1).toBe(10);
			expect(result2).toBe(10);
			expect(instance.callCount).toBe(2); // Should NOT be cached
		});

		it("should disable caching for async methods when FORGE_DISABLE_CACHE=true", async () => {
			process.env.FORGE_DISABLE_CACHE = "true";

			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = await instance.asyncMethod(5);
			const result2 = await instance.asyncMethod(5);

			expect(result1).toBe(15);
			expect(result2).toBe(15);
			expect(instance.callCount).toBe(2); // Should NOT be cached
		});

		it("should not interact with cache when disabled", async () => {
			process.env.FORGE_DISABLE_CACHE = "true";

			const setSpy = vi.spyOn(CACHE, "set");
			const getSpy = vi.spyOn(CACHE, "get");
			const hasSpy = vi.spyOn(CACHE, "has");

			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			instance.defaultOptionsMethod("value");
			instance.defaultOptionsMethod("value");

			expect(setSpy).not.toHaveBeenCalled();
			expect(getSpy).not.toHaveBeenCalled();
			expect(hasSpy).not.toHaveBeenCalled();
		});
	});

	describe("synchronous methods", () => {
		it("should cache sync method results", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = instance.syncMethod(5);
			const result2 = instance.syncMethod(5);

			expect(result1).toBe(10);
			expect(result2).toBe(10);
			expect(instance.callCount).toBe(1);
			expect(instance.counter).toHaveBeenCalledTimes(1);
		});

		it("should cache different arguments separately", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = instance.syncMethod(5);
			const result2 = instance.syncMethod(10);
			const result3 = instance.syncMethod(5);

			expect(result1).toBe(10);
			expect(result2).toBe(20);
			expect(result3).toBe(10);
			expect(instance.callCount).toBe(2); // Called for 5 and 10, but cached for second 5
		});

		it("should cache multiple arguments", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = instance.multiArgMethod(3, 4);
			const result2 = instance.multiArgMethod(3, 4);
			const result3 = instance.multiArgMethod(5, 6);

			expect(result1).toBe(7);
			expect(result2).toBe(7);
			expect(result3).toBe(11);
			expect(instance.callCount).toBe(2); // Called for (3,4) and (5,6)
		});

		it("should cache undefined return values", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = instance.undefinedMethod();
			const result2 = instance.undefinedMethod();

			expect(result1).toBeUndefined();
			expect(result2).toBeUndefined();
			expect(instance.callCount).toBe(1); // Should be cached
		});

		it("should cache falsy return values", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = instance.falsyMethod();
			const result2 = instance.falsyMethod();

			expect(result1).toBe(0);
			expect(result2).toBe(0);
			expect(instance.callCount).toBe(1); // Should be cached
		});
	});

	describe("asynchronous methods", () => {
		it("should cache async method results", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = await instance.asyncMethod(5);
			const result2 = await instance.asyncMethod(5);

			expect(result1).toBe(15);
			expect(result2).toBe(15);
			expect(instance.callCount).toBe(1);
		});

		it("should return Promise for async methods", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result = instance.asyncMethod(5);

			expect(result).toBeInstanceOf(Promise);
			await result; // Wait for completion
		});

		it("should cache different async arguments separately", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = await instance.asyncMethod(5);
			const result2 = await instance.asyncMethod(10);
			const result3 = await instance.asyncMethod(5);

			expect(result1).toBe(15);
			expect(result2).toBe(30);
			expect(result3).toBe(15);
			expect(instance.callCount).toBe(2);
		});
	});

	describe("cache isolation and sharing", () => {
		it("should isolate cache per instance", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance1 = new CacheTestClass();
			const instance2 = new CacheTestClass();

			const result1 = instance1.syncMethod(5);
			const result2 = instance2.syncMethod(5);

			expect(result1).toBe(10);
			expect(result2).toBe(10);
			// Each instance has its own cache entry — both execute the method
			expect(instance1.callCount).toBe(1);
			expect(instance2.callCount).toBe(1);
		});
	});

	describe("named cache support", () => {
		it("should use named cache from Caching manager", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = instance.namedCacheMethod(5);
			const result2 = instance.namedCacheMethod(5);

			expect(result1).toBe(25);
			expect(result2).toBe(25);
			expect(instance.callCount).toBe(1); // Should be cached
		});

		it("should clear named cache via Caching manager", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = instance.namedCacheMethod(5);
			expect(result1).toBe(25);
			expect(instance.callCount).toBe(1);

			// Clear the cache
			Caching.flushAllCaches();

			const result2 = instance.namedCacheMethod(5);
			expect(result2).toBe(25);
			expect(instance.callCount).toBe(2); // Should be called again after clear
		});
	});

	describe("default cache options", () => {
		it("should work with default options", async () => {
			const { CacheTestClass } = await import(importUrl());
			const instance = new CacheTestClass();

			const result1 = instance.defaultOptionsMethod("value");
			const result2 = instance.defaultOptionsMethod("value");

			expect(result1).toBe("test-value");
			expect(result2).toBe("test-value");
			expect(instance.callCount).toBe(1); // Should be cached with default cache
		});
	});
});
