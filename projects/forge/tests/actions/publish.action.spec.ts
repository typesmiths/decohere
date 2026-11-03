import { Project, Workspace } from "@decohere/workspace";
import { Npm, type npm, type shell } from "@decohere/devkit/interop";
import { beforeEach, expect, it, vi } from "vitest";
import { Publish, type PublishResponse } from "../../src/actions/publish.action.js";
import { Release, WorkspaceDefaults } from "../../src/workspace.config.js";

vi.mock("../../../devkit/src/interop/npm/npm.js");

beforeEach(() => {
	vi.spyOn(Npm.prototype, "publish").mockResolvedValue({} as shell.ShellResponse);
});

it("run should call npm.publish with expected arguments", async () => {
	const npmPublish = vi
		.spyOn(Npm.prototype, "publish")
		.mockResolvedValue({} as shell.ShellResponse);
	const publish = new Publish(
		new Workspace({
			config: WorkspaceDefaults,
			projects: [{ name: "MOCK", config: WorkspaceDefaults }],
		}),
	);
	await publish.run({
		dryRun: true,
		configuration: Release.name,
	});
	expect(npmPublish).toHaveBeenCalledWith<[string, npm.PublishOptions]>("dist/release/MOCK", {
		skipIfPublished: true,
		dryRun: true,
		channel: undefined,
		authToken: undefined,
		otp: undefined,
	});
});

it("run should return responses from shell", async () => {
	const shellResponse: shell.ShellResponse = { message: "MOCK_RESPONSE", data: [] };
	vi.spyOn(Npm.prototype, "publish").mockResolvedValue(shellResponse);
	const publishResponse: PublishResponse = {
		projectName: "MOCK",
		succeeded: true,
		message: "MOCK_RESPONSE",
		packageName: "",
	};
	const publish = new Publish(
		new Workspace({
			config: WorkspaceDefaults,
			projects: [{ name: "MOCK", config: WorkspaceDefaults }],
		}),
	);
	const response = await publish.run({
		dryRun: true,
		configuration: Release.name,
	});
	expect(response.data).toContainEqual(publishResponse);
});

it("should call npm.publish with expected args", async () => {
	const npmPublish = vi.spyOn(Npm.prototype, "publish");
	const project = new Project(
		"MOCK",
		{ ...WorkspaceDefaults, configurations: [Release] },
		Release.name,
	);
	const publish = new Publish(new Workspace({}));
	await publish.publishProjects([project], {
		configuration: Release.name,
	});
	expect(npmPublish).toHaveBeenCalledWith<[string, npm.PublishOptions]>("dist/release/MOCK", {
		skipIfPublished: true,
		dryRun: undefined,
		channel: undefined,
		authToken: undefined,
		otp: undefined,
	});
});

it("should call npm.publish foreach projec", async () => {
	const npmPublish = vi.spyOn(Npm.prototype, "publish");
	const project1 = new Project("MOCK1", WorkspaceDefaults, Release.name);
	const project2 = new Project("MOCk2", WorkspaceDefaults, Release.name);
	const publish = new Publish(new Workspace({}));
	await publish.publishProjects([project1, project2], {
		configuration: Release.name,
	});
	expect(npmPublish).toHaveBeenCalledTimes(2);
	expect(npmPublish).toHaveBeenCalledWith<[string, npm.PublishOptions]>(
		`dist/release/${project1.name}`,
		{
			skipIfPublished: true,
			dryRun: undefined,
			channel: undefined,
			authToken: undefined,
			otp: undefined,
		},
	);

	expect(npmPublish).toHaveBeenCalledWith<[string, npm.PublishOptions]>(
		`dist/release/${project2.name}`,
		{
			skipIfPublished: true,
			dryRun: undefined,
			channel: undefined,
			authToken: undefined,
			otp: undefined,
		},
	);
});

it("should skip private packages", async () => {
	const npmPublish = vi.spyOn(Npm.prototype, "publish");
	const privateProject = new Project("PRIVATE", {
		...WorkspaceDefaults,
		packageJson: new (await import("@decohere/workspace")).PackageJson({
			name: "PRIVATE",
			private: true,
		}),
	});
	const publicProject = new Project("PUBLIC", WorkspaceDefaults, Release.name);
	const publish = new Publish(new Workspace({}));
	await publish.publishProjects([privateProject, publicProject], {
		configuration: Release.name,
	});
	expect(npmPublish).toHaveBeenCalledTimes(1);
	expect(npmPublish).toHaveBeenCalledWith<[string, npm.PublishOptions]>(
		`dist/release/${publicProject.name}`,
		{
			skipIfPublished: true,
			dryRun: undefined,
			channel: undefined,
			authToken: undefined,
			otp: undefined,
		},
	);
});

it("should call npm.publish with dry run argument", async () => {
	const npmPublish = vi.spyOn(Npm.prototype, "publish");
	const project = new Project("MOCK", WorkspaceDefaults, Release.name);
	const publish = new Publish(new Workspace({}));
	await publish.publishProjects([project], {
		dryRun: true,
		configuration: Release.name,
	});
	expect(npmPublish).toHaveBeenCalledWith<[string, npm.PublishOptions]>("dist/release/MOCK", {
		skipIfPublished: true,
		dryRun: true,
		channel: undefined,
		authToken: undefined,
		otp: undefined,
	});
});
