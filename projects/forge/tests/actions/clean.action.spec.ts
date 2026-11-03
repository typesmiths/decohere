import { WorkspaceFactory } from "@decohere/workspace";
import { Caching } from "@decohere/core/caching";
import { fileExists, resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Clean } from "../../src/actions/clean.action.js";
import { WorkspaceDefaults } from "../../src/workspace.config.js";

const mockFiles = {
	"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
	"/projects/project1/package.json": JSON.stringify({ name: "MOCK_PROJ" }),
	"/projects/project1/src/index.ts": "export const value = 1;",
};

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	Caching.flushAllCaches();
	vi.restoreAllMocks();
});

it("should clean output directory by default", async () => {
	const DIRTY_FILE = "/dist/debug/projects/LEFT_OVER.txt";
	vol.fromJSON({ ...mockFiles, [DIRTY_FILE]: "" });
	expect(fileExists(DIRTY_FILE)).toBe(true);

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const cleanAction = new Clean(workspace);
	await cleanAction.run({ clean: true, configuration: "debug" });

	expect(fileExists(DIRTY_FILE)).toBe(false);
});

it("should skip clean when no-clean option is specified", async () => {
	const DIRTY_FILE = "/dist/debug/projects/LEFT_OVER.txt";
	vol.fromJSON({ ...mockFiles, [DIRTY_FILE]: "" });

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const cleanAction = new Clean(workspace);
	const response = await cleanAction.run({ clean: false, configuration: "debug" });

	expect(response.skipped).toBe(true);
	expect(fileExists(DIRTY_FILE)).toBe(true);
});
