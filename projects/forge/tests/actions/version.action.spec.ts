import type { PackageJson, Workspace } from "@decohere/workspace";
import { Project, WorkspaceFactory } from "@decohere/workspace";
import { Git } from "@decohere/devkit/interop";
import { io } from "@decohere/core/io";
import { Semver } from "../../src/semver/index.js";
import { vol } from "memfs";
import { afterEach, expect, it, vi } from "vitest";
import { Version } from "../../src/actions/version.action.js";
import { WorkspaceDefaults } from "../../src/workspace.config.js";

const project1Path = `projects/MOCK_PROJ1`;
const project2Path = `projects/MOCK_PROJ2`;
const version = "1.0.0-beta.0";
const mockFiles = {
	"./package.json": JSON.stringify({ name: "ROOT", version }),
	[`${project1Path}/package.json`]: JSON.stringify({
		name: "MOCK_PROJ1",
		version,
	}),
	[`${project2Path}/package.json`]: JSON.stringify({
		name: "MOCK_PROJ2",
		version,
	}),
};

afterEach(() => {
	vi.restoreAllMocks();
});

it("should update package versions for root and projects", async () => {
	vol.fromJSON(mockFiles);
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new Version(null as unknown as Workspace);
	vi.spyOn(action as never, "resolveVersionFromGitTag").mockReturnValue(undefined);
	const responses = await action.version(workspace);
	expect(responses.data).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ name: "ROOT", succeeded: true }),
			expect.objectContaining({ name: "MOCK_PROJ1", succeeded: true }),
			expect.objectContaining({ name: "MOCK_PROJ2", succeeded: true }),
		]),
	);

	const proj1PackageJson = (await io.readJsonFile(
		`${project1Path}/package.json`,
	)) as PackageJson;

	const rootPackageJson = (await io.readJsonFile(`./package.json`)) as PackageJson;

	expect(proj1PackageJson.version).toBe("1.0.0-beta.1");
	expect(rootPackageJson.version).toBe("1.0.0-beta.1");
});

it("version should return error response if error thrown from async tasks", async () => {
	vol.fromJSON(mockFiles);
	vi.spyOn(Project.prototype, "getPackageJson").mockRejectedValue("ERROR");
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const version = new Version(workspace);
	const result = await version.version(workspace);
	expect(result.succeeded).toBe(false);
});

it("run should throw if there is an error", async () => {
	vol.fromJSON(mockFiles);
	vi.spyOn(Semver.prototype, "increment").mockImplementation(() => {
		throw "ERROR";
	});
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const version = new Version(workspace);
	const versionFunc = () => version.run({});
	await expect(versionFunc).rejects.toThrow();
});

it("should default base version from latest git tag", async () => {
	vol.fromJSON(mockFiles);
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new Version(null as unknown as Workspace);
	vi.spyOn(action as never, "resolveVersionFromGitTag").mockReturnValue("2.1.3");

	await action.version(workspace, {
		releaseType: "patch",
		channel: "beta",
	});

	const rootPackageJson = (await io.readJsonFile(`./package.json`)) as PackageJson;
	expect(rootPackageJson.version).toBe("2.1.4");
});

it("should use explicit version when provided", async () => {
	vol.fromJSON(mockFiles);
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new Version(null as unknown as Workspace);
	const tagSpy = vi
		.spyOn(action as never, "resolveVersionFromGitTag")
		.mockReturnValue("9.9.9");

	await action.version(workspace, {
		releaseType: "patch",
		version: "3.0.0",
	});

	expect(tagSpy).not.toHaveBeenCalled();
	const rootPackageJson = (await io.readJsonFile(`./package.json`)) as PackageJson;
	expect(rootPackageJson.version).toBe("3.0.1");
});

it("should commit versioned package.json files when --commit is set", async () => {
	vol.fromJSON(mockFiles);
	const commitSpy = vi
		.spyOn(Git.prototype, "commit")
		.mockResolvedValue({ message: "", data: [] });
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new Version(null as unknown as Workspace);
	await action.version(workspace, {
		releaseType: "prerelease",
		channel: "beta",
		commit: true,
	});

	expect(commitSpy).toHaveBeenCalledOnce();
	expect(commitSpy).toHaveBeenCalledWith(
		expect.stringContaining("chore: version packages"),
		expect.objectContaining({
			files: expect.arrayContaining([expect.stringContaining("package.json")]),
		}),
	);
});

it("should not commit when --dry-run is set", async () => {
	vol.fromJSON(mockFiles);
	const commitSpy = vi
		.spyOn(Git.prototype, "commit")
		.mockResolvedValue({ message: "", data: [] });
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new Version(null as unknown as Workspace);
	await action.version(workspace, {
		releaseType: "prerelease",
		channel: "beta",
		commit: true,
		dryRun: true,
	});

	expect(commitSpy).not.toHaveBeenCalled();
});
