import { Workspace } from "@decohere/workspace";
import { Caching } from "@decohere/core/caching";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgeModule } from "../src/forge.module.js";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
	vol.fromJSON({
		"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
		"/projects/lib1/package.json": JSON.stringify({ name: "lib1", version: "1.0.0" }),
		"/projects/lib1/src/index.ts": "export const value = 1;",
		"/tsconfig.json": JSON.stringify({
			compilerOptions: {
				baseUrl: ".",
				paths: { "@MOCK/lib1": ["projects/lib1/src/index.ts"] },
			},
		}),
	});
});

afterEach(() => {
	resetMemfs();
	Caching.flushAllCaches();
	vi.restoreAllMocks();
});

describe("ForgeModule.createWorkspace", () => {
	it("should return a Workspace instance", async () => {
		const module = new ForgeModule();
		const workspace = await module.createWorkspace({});
		expect(workspace).toBeInstanceOf(Workspace);
	});

	it("should return a non-null workspace so actions can be resolved from the DI container", async () => {
		const module = new ForgeModule();
		// If this returned null, Build/Clean/Copy would throw ResolveError at runtime.
		// This test makes that contract explicit and catches regressions early.
		await expect(module.createWorkspace({})).resolves.not.toBeNull();
	});

	it("should produce a workspace with forge configurations (debug and release)", async () => {
		const module = new ForgeModule();
		const workspace = await module.createWorkspace({});
		expect(workspace).toBeInstanceOf(Workspace);

		const w = workspace as Workspace;
		expect(w.getProjects("debug").length).toBeGreaterThan(0);
		expect(w.getProjects("release").length).toBeGreaterThan(0);
	});

	it("projects should resolve the root tsconfig via fallback when no rootDir is provided", async () => {
		// Regression: createWorkspace({ rootDir: undefined }) was spreading `rootDir: undefined`
		// after forgeDefaults, which overrode the default "./" and caused fallbackTsConfigDirectory
		// to return undefined — so tsconfig paths were never loaded for alias resolution.
		const module = new ForgeModule();
		const workspace = (await module.createWorkspace({})) as Workspace;
		const [project] = workspace.getProjects("debug");
		const tsConfig = await project.getTsConfig();
		expect(tsConfig.compilerOptions.paths).toBeDefined();
	});
});
