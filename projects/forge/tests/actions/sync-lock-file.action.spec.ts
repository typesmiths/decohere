import { Pnpm } from "@decohere/devkit/interop";
import { beforeEach, expect, it, vi } from "vitest";
import { SyncLockFile } from "../../src/actions/sync-lock-file.action.js";

beforeEach(() => {
	vi.restoreAllMocks();
});

it("should sync lockfile by default", async () => {
	const action = new SyncLockFile();
	const syncSpy = vi.spyOn(Pnpm.prototype, "syncLockFile").mockResolvedValue({
		message: "ok",
		data: [],
	});

	await action.run({});
	expect(syncSpy).toHaveBeenCalledOnce();
});

it("should skip sync when disabled", async () => {
	const action = new SyncLockFile();
	const syncSpy = vi.spyOn(Pnpm.prototype, "syncLockFile").mockResolvedValue({
		message: "ok",
		data: [],
	});

	await action.run({ sync: false });
	expect(syncSpy).not.toHaveBeenCalled();
});

it("should skip sync in dry-run mode", async () => {
	const action = new SyncLockFile();
	const syncSpy = vi.spyOn(Pnpm.prototype, "syncLockFile").mockResolvedValue({
		message: "ok",
		data: [],
	});

	const response = await action.run({ dryRun: true });

	expect(response.skipped).toBe(true);
	expect(syncSpy).not.toHaveBeenCalled();
});
