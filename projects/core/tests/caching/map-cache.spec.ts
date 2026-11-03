import { afterEach, describe, expect, it } from "vitest";
import { Caching } from "../../src/caching/cache-manager.js";
import { MapCache } from "../../src/caching/map-cache.js";

describe("MapCache: the built-in cache, a plain Map", () => {
	afterEach(() => {
		Caching.flushAllCaches();
		Caching.removeCache("COPY_524");
		Caching.removeCache("MEMO_524");
	});

	it("hands out a copy of an object by default, so a caller can't change the cached value", () => {
		const cache = new MapCache();
		const value = { items: [1, 2] };
		cache.set("key", value);

		const first = cache.get("key") as typeof value;
		first.items.push(3);

		expect(first).not.toBe(value);
		expect(cache.get("key")).toEqual({ items: [1, 2] });
	});

	it("hands out the same reference when memoizing", () => {
		const cache = new MapCache({ memoize: true });
		const value = { items: [1, 2] };
		cache.set("key", value);

		expect(cache.get("key")).toBe(value);
		expect(cache.isMemoize).toBe(true);
	});

	it("passes scalars, null and undefined through unchanged", () => {
		const cache = new MapCache();
		cache.set("n", 1);
		cache.set("s", "a");
		cache.set("null", null);

		expect(cache.get("n")).toBe(1);
		expect(cache.get("s")).toBe("a");
		expect(cache.get("null")).toBeNull();
		expect(cache.get("missing")).toBeUndefined();
		expect(cache.isMemoize).toBe(false);
	});

	it("has, del and flushAll work on the stored keys", () => {
		const cache = new MapCache();
		cache.set("a", 1);
		cache.set("b", 2);

		expect(cache.has("a")).toBe(true);
		cache.del("a");
		expect(cache.has("a")).toBe(false);
		cache.flushAll();
		expect(cache.has("b")).toBe(false);
	});

	it("is what the cache manager creates for a new name: copying, or by reference for memoize", () => {
		const copying = Caching.getCache("COPY_524");
		const memo = Caching.getCache("MEMO_524", true);

		expect(copying).toBeInstanceOf(MapCache);
		expect(copying.isMemoize).toBe(false);
		expect(memo).toBeInstanceOf(MapCache);
		expect(memo.isMemoize).toBe(true);
	});
});
