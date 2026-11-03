import { WorkspaceFactory } from "@decohere/workspace";
import { Git } from "@decohere/devkit/interop";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { beforeEach, expect, it, vi } from "vitest";
import { CommitFiles } from "../../src/actions/commit.action.js";
import { WorkspaceDefaults } from "../../src/workspace.config.js";

const appPath = "projects/app1";
const lib1Path = "projects/lib1";
const lib2Path = "projects/lib2";

const mockFiles = {
	"package.json": JSON.stringify({
		name: "@MOCK_ORG/WORKSPACE",
		version: "1.0.0",
		dependencies: {},
		devDependencies: {},
	}),
	"pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
	[`${appPath}/package.json`]: JSON.stringify({
		name: "@MOCK_ORG/MOCK_APP1",
		version: "1.0.0",
		dependencies: {},
		devDependencies: {},
	}),
	[`${lib1Path}/package.json`]: JSON.stringify({
		name: "@MOCK_ORG/MOCK_LIB1",
		version: "1.0.0",
		dependencies: {},
		devDependencies: {},
	}),
	[`${lib2Path}/package.json`]: JSON.stringify({
		name: "@MOCK_ORG/MOCK_LIB2",
		version: "1.0.0",
		dependencies: {},
		devDependencies: {},
	}),
};

beforeEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

it("should skip when commit is disabled", async () => {
	vol.fromJSON(mockFiles);
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new CommitFiles(workspace);
	const commitSpy = vi.spyOn(Git.prototype, "commit").mockResolvedValue({
		message: "ok",
		data: [],
	});

	const response = await action.run({ commit: false });

	expect(response.skipped).toBe(true);
	expect(commitSpy).not.toHaveBeenCalled();
});

it("should commit default workspace manifest and lockfile paths", async () => {
	vol.fromJSON(mockFiles);
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new CommitFiles(workspace);
	const commitSpy = vi.spyOn(Git.prototype, "commit").mockResolvedValue({
		message: "ok",
		data: [],
	});

	await action.run({
		configuration: "release",
		commit: true,
		message: "chore: version packages and sync cross-library dependencies [skip ci]",
	});

	expect(commitSpy).toHaveBeenCalledWith(
		"chore: version packages and sync cross-library dependencies [skip ci]",
		expect.objectContaining({
			files: expect.arrayContaining([
				"package.json",
				`${appPath}/package.json`,
				`${lib1Path}/package.json`,
				`${lib2Path}/package.json`,
				"pnpm-lock.yaml",
			]),
		}),
	);
});

it("should honor explicitly provided files", async () => {
	vol.fromJSON(mockFiles);
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new CommitFiles(workspace);
	const commitSpy = vi.spyOn(Git.prototype, "commit").mockResolvedValue({
		message: "ok",
		data: [],
	});

	await action.run({
		commit: true,
		message: "chore: explicit files [skip ci]",
		files: ["package.json", "pnpm-lock.yaml"],
	});

	expect(commitSpy).toHaveBeenCalledWith("chore: explicit files [skip ci]", {
		files: ["package.json", "pnpm-lock.yaml"],
	});
});
