import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scribe } from "@decohere/scribe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranspileDiskCache } from "../src/transpile-disk-cache.js";

// The cache reads and writes a real directory.
vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.unmock("node:fs/promises");

let dir: string;
const options = { jsc: { target: "esnext" } };

function cacheIn(cacheDir: string) {
	vi.stubEnv("DECOHERE_CACHE_DIR", cacheDir);
	const cache = TranspileDiskCache.forWorkspace("/unused");
	if (cache == null) throw new Error("expected a cache");
	return cache;
}

describe("TranspileDiskCache", () => {
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), "flux-disk-cache-"));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
	});

	it("reads back what it wrote, sync or async", async () => {
		const cache = cacheIn(dir);
		const key = cache.keyFor("/w/a.ts", "export const a: number = 1;", options);

		expect(cache.readSync(key)).toBeUndefined();
		cache.writeSync(key, "export const a = 1;");
		expect(cache.readSync(key)).toBe("export const a = 1;");

		const other = cache.keyFor("/w/b.ts", "export const b = 2;", options);
		await cache.write(other, "export const b = 2;");
		expect(await cache.read(other)).toBe("export const b = 2;");
	});

	it("misses when the path, the source or the options differ", () => {
		const cache = cacheIn(dir);
		const key = cache.keyFor("/w/a.ts", "source", options);
		expect(cache.keyFor("/w/b.ts", "source", options)).not.toBe(key);
		expect(cache.keyFor("/w/a.ts", "source changed", options)).not.toBe(key);
		expect(cache.keyFor("/w/a.ts", "source", { jsc: { target: "es2019" } })).not.toBe(key);
		expect(cache.keyFor("/w/a.ts", "source", { jsc: { target: "esnext" } })).toBe(key);
	});

	it("is off with DECOHERE_CACHE=0", () => {
		vi.stubEnv("DECOHERE_CACHE", "0");
		expect(TranspileDiskCache.forWorkspace(dir)).toBeNull();
	});

	it("warns once and turns itself off when it cannot write, without failing the caller", () => {
		const warn = vi.fn();
		vi.spyOn(scribe, "logger").mockReturnValue({ warn } as never);
		// A directory under a regular file can't be created, whoever runs the test.
		writeFileSync(path.join(dir, "blocker"), "");
		const cache = cacheIn(path.join(dir, "blocker", "cache"));

		cache.writeSync(cache.keyFor("/w/a.ts", "a", options), "a");
		cache.writeSync(cache.keyFor("/w/b.ts", "b", options), "b");

		expect(warn).toHaveBeenCalledOnce();
		expect(String(warn.mock.calls[0]?.[0])).toContain("Transpile cache turned off");
		expect(cache.readSync(cache.keyFor("/w/a.ts", "a", options))).toBeUndefined();
	});

	// A write renames its temp file between the prune's listing and its stat: that must not turn
	// the cache off for the writes still to come.
	it("keeps working when entries are written while it prunes", async () => {
		const warn = vi.fn();
		vi.spyOn(scribe, "logger").mockReturnValue({ warn } as never);
		const cache = cacheIn(dir);
		const keys = Array.from({ length: 200 }, (_, i) =>
			cache.keyFor(`/w/f${i}.ts`, `${i}`, options),
		);

		await Promise.all([
			cache.pruneIfDue(),
			...keys.map((key, i) => cache.write(key, `code ${i}`)),
		]);

		expect(warn).not.toHaveBeenCalled();
		const late = cache.keyFor("/w/late.ts", "late", options);
		cache.writeSync(late, "late");
		expect(cache.readSync(late)).toBe("late");
		expect(keys.map((key) => cache.readSync(key))).toEqual(keys.map((_, i) => `code ${i}`));
	});

	it("prunes entries untouched for 30 days, at most once a day", async () => {
		const cache = cacheIn(dir);
		const oldKey = cache.keyFor("/w/old.ts", "old", options);
		const newKey = cache.keyFor("/w/new.ts", "new", options);
		cache.writeSync(oldKey, "old");
		cache.writeSync(newKey, "new");
		const now = Date.now();
		const shard = path.join(cache.directory, oldKey.slice(0, 2));
		const fortyDaysAgo = (now - 40 * 24 * 60 * 60 * 1000) / 1000;
		utimesSync(path.join(shard, `${oldKey}.js`), fortyDaysAgo, fortyDaysAgo);

		await cache.pruneIfDue(now);
		expect(cache.readSync(oldKey)).toBeUndefined();
		expect(cache.readSync(newKey)).toBe("new");

		// Pruned less than a day ago: the next call does nothing.
		cache.writeSync(oldKey, "old");
		utimesSync(path.join(shard, `${oldKey}.js`), fortyDaysAgo, fortyDaysAgo);
		await cache.pruneIfDue(now + 60 * 60 * 1000);
		expect(cache.readSync(oldKey)).toBe("old");
	});
});
