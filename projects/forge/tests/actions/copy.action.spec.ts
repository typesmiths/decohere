import { WorkspaceFactory } from "@decohere/workspace";
import { Caching } from "@decohere/core/caching";
import { fileExists, resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Copy } from "../../src/actions/copy.action.js";
import { WorkspaceDefaults } from "../../src/workspace.config.js";

const mockFiles = {
	"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
	"/projects/project1/package.json": JSON.stringify({ name: "MOCK_PROJ" }),
	"/projects/project1/src/index.ts": "export const value = 1;",
};

const outDir = "/dist/debug/projects/project1";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	Caching.flushAllCaches();
	vi.restoreAllMocks();
});

it("should copy non-source files defined in copy pattern", async () => {
	vol.fromJSON(mockFiles);

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const copyAction = new Copy(workspace);
	const response = await copyAction.run({ copy: true, configuration: "debug" });

	expect(response.succeeded).toBe(true);
	expect(fileExists(`${outDir}/package.json`)).toBe(true);
});

it("should copy debug fixture trees into the out dir", async () => {
	vol.fromJSON({
		...mockFiles,
		"/projects/project1/tests/__fixtures__/hmr/main.ts": "export const x = 1;",
		"/projects/project1/tests/__fixtures__/.decohere.js": "export default {};",
	});

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const copyAction = new Copy(workspace);
	const response = await copyAction.run({ copy: true, configuration: "debug" });

	expect(response.succeeded).toBe(true);
	expect(fileExists(`${outDir}/tests/__fixtures__/hmr/main.ts`)).toBe(true);
	expect(fileExists(`${outDir}/tests/__fixtures__/.decohere.js`)).toBe(true);
});

it("should skip copy when no-copy option is specified", async () => {
	vol.fromJSON(mockFiles);

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const copyAction = new Copy(workspace);
	const response = await copyAction.run({ copy: false, configuration: "debug" });

	expect(response.skipped).toBe(true);
	expect(fileExists(`${outDir}/package.json`)).toBe(false);
});

it("copies configuration copyFiles into each pack target out dir", async () => {
	vol.fromJSON({
		...mockFiles,
		"/projects/project1/src/webapi/devcontainer/templates/initialize.sh": "#!/bin/bash\n",
	});

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const copyAction = new Copy(workspace);
	const response = await copyAction.run({ copy: true, configuration: "release" });

	expect(response.succeeded).toBe(true);
	expect(
		fileExists(
			"/dist/release/projects/project1/es6/src/webapi/devcontainer/templates/initialize.sh",
		),
	).toBe(true);
	expect(
		fileExists(
			"/dist/release/projects/project1/src/webapi/devcontainer/templates/initialize.sh",
		),
	).toBe(true);
});

it("keeps workspace copyFiles (package.json) at the package root only", async () => {
	vol.fromJSON(mockFiles);

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const copyAction = new Copy(workspace);
	const response = await copyAction.run({ copy: true, configuration: "release" });

	expect(response.succeeded).toBe(true);
	expect(fileExists("/dist/release/projects/project1/package.json")).toBe(true);
	expect(fileExists("/dist/release/projects/project1/es6/package.json")).toBe(false);
	expect(fileExists("/dist/release/projects/project1/commonjs/package.json")).toBe(false);
	expect(fileExists("/dist/release/projects/project1/types/package.json")).toBe(false);
});

it("puts README.md and LICENSE files at the release package root only", async () => {
	vol.fromJSON({
		...mockFiles,
		"/projects/project1/README.md": "# project1",
		"/projects/project1/LICENSE": "MIT",
		"/projects/project1/LICENSE.md": "MIT",
		"/projects/project1/docs/README.md": "# nested",
	});

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const copyAction = new Copy(workspace);
	const response = await copyAction.run({ copy: true, configuration: "release" });

	expect(response.succeeded).toBe(true);
	expect(fileExists("/dist/release/projects/project1/README.md")).toBe(true);
	expect(fileExists("/dist/release/projects/project1/LICENSE")).toBe(true);
	expect(fileExists("/dist/release/projects/project1/LICENSE.md")).toBe(true);
	expect(fileExists("/dist/release/projects/project1/docs/README.md")).toBe(false);
	expect(fileExists("/dist/release/projects/project1/es6/README.md")).toBe(false);
});

it("still builds when a project has no README.md or LICENSE", async () => {
	vol.fromJSON(mockFiles);

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const copyAction = new Copy(workspace);
	const response = await copyAction.run({ copy: true, configuration: "release" });

	expect(response.succeeded).toBe(true);
	expect(fileExists("/dist/release/projects/project1/package.json")).toBe(true);
	expect(fileExists("/dist/release/projects/project1/README.md")).toBe(false);
});

it("packs the workspace LICENSE into a package that has none of its own", async () => {
	vol.fromJSON({ ...mockFiles, "/LICENSE": "ROOT LICENSE" });

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const response = await new Copy(workspace).run({ copy: true, configuration: "release" });

	expect(response.succeeded).toBe(true);
	expect(vol.readFileSync("/dist/release/projects/project1/LICENSE", "utf8")).toBe(
		"ROOT LICENSE",
	);
});

it("keeps a package's own LICENSE over the workspace one", async () => {
	vol.fromJSON({
		...mockFiles,
		"/LICENSE": "ROOT LICENSE",
		"/projects/project1/LICENSE.md": "PACKAGE LICENSE",
	});

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	await new Copy(workspace).run({ copy: true, configuration: "release" });

	expect(vol.readFileSync("/dist/release/projects/project1/LICENSE.md", "utf8")).toBe(
		"PACKAGE LICENSE",
	);
	expect(fileExists("/dist/release/projects/project1/LICENSE")).toBe(false);
});

it("leaves the workspace LICENSE out of builds that do not pack", async () => {
	vol.fromJSON({ ...mockFiles, "/LICENSE": "ROOT LICENSE" });

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	await new Copy(workspace).run({ copy: true, configuration: "debug" });

	expect(fileExists(`${outDir}/LICENSE`)).toBe(false);
});
