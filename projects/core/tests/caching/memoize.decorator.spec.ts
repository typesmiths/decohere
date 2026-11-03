import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pathToFileUrl } from "../../src/io/url-to-path.js";
import { MEMOIZE_CACHE } from "./memoize-test-class.js";

// Test class import path constant
const MEMOIZE_TEST_CLASS_PATH = "./memoize-test-class.js";

// Function-based import URL for easier refactoring
const importUrl = () => getImportUrl(MEMOIZE_TEST_CLASS_PATH);

// Helper function to create a versioned import URL for cache busting
function getImportUrl(filename: string): string {
	const modulePath = path.resolve(__dirname, filename);
	const moduleUrl = pathToFileUrl(modulePath);
	return `${moduleUrl}?version=${Date.now()}`;
}

describe("memoize decorator", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		MEMOIZE_CACHE.flushAll();
		delete process.env.FORGE_DISABLE_CACHE;
	});

	describe("FORGE_DISABLE_CACHE environment variable behavior", () => {
		it("should memoize normally by default", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const result1 = instance.syncMethod(5);
			const result2 = instance.syncMethod(5);

			expect(result1).toBe(10);
			expect(result2).toBe(10);
			expect(instance.callCount).toBe(1); // Should be memoized
		});

		it("should not memoize when FORGE_DISABLE_CACHE=true", async () => {
			process.env.FORGE_DISABLE_CACHE = "true";

			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const result1 = instance.syncMethod(5);
			const result2 = instance.syncMethod(5);

			expect(result1).toBe(10);
			expect(result2).toBe(10);
			expect(instance.callCount).toBe(2); // Should not be memoized
		});
	});

	describe("memoization functionality", () => {
		it("should memoize synchronous method results", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const result1 = instance.syncMethod(42);
			const result2 = instance.syncMethod(42);

			expect(result1).toBe(84);
			expect(result2).toBe(84);
			expect(instance.callCount).toBe(1);
		});

		it("should memoize asynchronous method results", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const result1 = await instance.asyncMethod(10);
			const result2 = await instance.asyncMethod(10);

			expect(result1).toBe(30);
			expect(result2).toBe(30);
			expect(instance.callCount).toBe(1);
		});

		it("should handle multiple arguments", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const result1 = instance.multiArgMethod(5, 3);
			const result2 = instance.multiArgMethod(5, 3);
			const result3 = instance.multiArgMethod(5, 4);

			expect(result1).toBe(8);
			expect(result2).toBe(8);
			expect(result3).toBe(9);
			expect(instance.callCount).toBe(2); // Two different argument sets
		});

		it("should handle undefined return values", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const result1 = instance.undefinedMethod();
			const result2 = instance.undefinedMethod();

			expect(result1).toBeUndefined();
			expect(result2).toBeUndefined();
			expect(instance.callCount).toBe(1);
		});

		it("should handle falsy return values", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const result1 = instance.falsyMethod();
			const result2 = instance.falsyMethod();

			expect(result1).toBe(0);
			expect(result2).toBe(0);
			expect(instance.callCount).toBe(1);
		});

		it("should support custom cache keys", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const result1 = instance.namedCacheMethod(7);
			const result2 = instance.namedCacheMethod(7);

			expect(result1).toBe(28);
			expect(result2).toBe(28);
			expect(instance.callCount).toBe(1);
		});

		it("should work with default cache", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const result1 = instance.defaultCacheMethod(6);
			const result2 = instance.defaultCacheMethod(6);

			expect(result1).toBe(30);
			expect(result2).toBe(30);
			expect(instance.callCount).toBe(1);
		});
	});

	describe("object reference behavior", () => {
		it("should call method only once for same arguments", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			instance.objectMethod(5);
			instance.objectMethod(5);

			expect(instance.callCount).toBe(1);
		});

		it("should return same object reference (not a clone)", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const obj1 = instance.objectMethod(5);
			const obj2 = instance.objectMethod(5);

			expect(obj1).toBe(obj2);
		});

		it("should preserve mutations across all references", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const obj1 = instance.objectMethod(5);
			obj1.value = 999;

			const obj2 = instance.objectMethod(5);

			expect(obj2.value).toBe(999);
		});

		it("should maintain same reference after mutation", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			const obj1 = instance.objectMethod(5);
			obj1.value = 999;

			const obj2 = instance.objectMethod(5);

			expect(obj2).toBe(obj1);
		});

		it("should not call method again after retrieving mutated object", async () => {
			const { MemoizeTestClass } = await import(importUrl());
			const instance = new MemoizeTestClass();

			instance.objectMethod(5);
			const callCountAfterFirst = instance.callCount;

			instance.objectMethod(5);
			const callCountAfterSecond = instance.callCount;

			expect(callCountAfterSecond).toBe(callCountAfterFirst);
		});
	});
});
