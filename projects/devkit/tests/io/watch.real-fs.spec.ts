import { afterEach, describe, expect, it, vi } from "vitest";

// Atomic saves are a real-filesystem behaviour, so this suite opts out of the memfs mock.
vi.unmock("fs");
vi.unmock("node:fs");
vi.unmock("fs/promises");
vi.unmock("node:fs/promises");

const { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { watch } = await import("../../src/io/watch.js");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `predicate` holds, polling, or fail after `timeoutMs`. */
async function eventually(predicate: () => boolean, timeoutMs = 2000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for watch events");
		await sleep(20);
	}
}

// Many editors (vim, sed -i, "safe write") and AI agents save by writing a temp file
// and renaming it over the original. With Node's recursive fs.watch on Linux the watcher then
// went silent for that file, so hot reload stopped reacting to it.
describe("io.watch on a real filesystem", () => {
	let dir: string | undefined;
	let close: (() => void) | undefined;

	afterEach(() => {
		close?.();
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("keeps reporting changes to a file after it is replaced by an atomic save", async () => {
		dir = mkdtempSync(join(tmpdir(), "decohere-watch-"));
		mkdirSync(join(dir, "src"));
		const file = join(dir, "src", "a.ts");
		writeFileSync(file, "v0");

		const changes: string[] = [];
		const watcher = watch(dir, { ignoreInitial: true });
		close = watcher.close;
		watcher.on("change", (f) => changes.push(f.relativePath));
		await watcher.ready;

		for (let i = 1; i <= 3; i++) {
			const tmp = join(dir, "src", `.a.ts.tmp${i}`);
			writeFileSync(tmp, `v${i}`);
			renameSync(tmp, file);
			await eventually(() => changes.filter((p) => p === "src/a.ts").length >= i);
		}

		writeFileSync(file, "a plain save after the atomic ones");
		await eventually(() => changes.filter((p) => p === "src/a.ts").length >= 4);
		expect(changes.filter((p) => p === "src/a.ts").length).toBeGreaterThanOrEqual(4);
	});

	it("reports files in a directory created after the watch started", async () => {
		dir = mkdtempSync(join(tmpdir(), "decohere-watch-"));
		const added: string[] = [];
		const watcher = watch(dir, { ignoreInitial: true });
		close = watcher.close;
		watcher.on("add", (f) => added.push(f.relativePath));
		await watcher.ready;

		mkdirSync(join(dir, "feature"));
		await sleep(50);
		writeFileSync(join(dir, "feature", "new.ts"), "x");

		await eventually(() => added.includes("feature/new.ts"));
		expect(added).toContain("feature/new.ts");
	});
});
