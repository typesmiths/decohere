import { Project, Workspace } from "@decohere/workspace";
import { Npm, type npm, type shell } from "@decohere/devkit/interop";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Publish, type PublishResponse } from "../../src/actions/publish.action.js";
import { Release, WorkspaceDefaults } from "../../src/workspace.config.js";

vi.mock("../../../devkit/src/interop/npm/npm.js");

beforeEach(() => {
	vi.spyOn(Npm.prototype, "publish").mockResolvedValue({} as shell.ShellResponse);
});

afterEach(() => {
	vol.reset();
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

describe("what a release build's package.json points at", () => {
	const OUT = "dist/release/MOCK";
	const publishing = () => {
		const project = {
			name: "MOCK",
			config: { ...WorkspaceDefaults, configurations: [Release] },
		};
		return new Publish(new Workspace({ config: WorkspaceDefaults, projects: [project] }));
	};
	const write = (manifest: object, files: string[] = []) => {
		vol.fromJSON({
			[`${OUT}/package.json`]: JSON.stringify({
				name: "@acme/mock",
				version: "1.0.0",
				...manifest,
			}),
			...Object.fromEntries(files.map((file) => [`${OUT}/${file}`, ""])),
		});
	};
	const options = { dryRun: true, configuration: Release.name };

	it("publishes when every declared file exists", async () => {
		write(
			{
				main: "./es6/src/index.js",
				types: "./types/src/index.d.ts",
				bin: { mock: "./es6/src/cli.js" },
				exports: {
					".": { types: "./types/src/index.d.ts", import: "./es6/src/index.js" },
					"./hidden": null,
					"./features/*": "./es6/src/features/*.js",
				},
			},
			["es6/src/index.js", "es6/src/cli.js", "types/src/index.d.ts", "es6/src/features/a.js"],
		);
		const npmPublish = vi.spyOn(Npm.prototype, "publish");

		await publishing().run(options);

		expect(npmPublish).toHaveBeenCalledOnce();
	});

	it.each([
		[
			"an exports condition",
			{ exports: { ".": { import: "./es6/src/gone.js" } } },
			"./es6/src/gone.js",
		],
		[
			"a types condition",
			{ exports: { ".": { types: "./types/gone.d.ts" } } },
			"./types/gone.d.ts",
		],
		["an exports string", { exports: "./es6/gone.js" }, "./es6/gone.js"],
		["a subpath pattern", { exports: { "./x/*": "./es6/gone/*.js" } }, "./es6/gone/*.js"],
		["main", { main: "./es6/gone.js" }, "./es6/gone.js"],
		["types", { types: "./types/gone.d.ts" }, "./types/gone.d.ts"],
		["a bin string", { bin: "./es6/gone.js" }, "./es6/gone.js"],
		["a bin entry", { bin: { mock: "./es6/gone.js" } }, "./es6/gone.js"],
	])(
		"stops, publishing nothing, when %s points at a missing file",
		async (_name, manifest, file) => {
			write(manifest);
			const npmPublish = vi.spyOn(Npm.prototype, "publish");

			await expect(publishing().run(options)).rejects.toThrow(`@acme/mock: ${file}`);

			expect(npmPublish).not.toHaveBeenCalled();
		},
	);

	it("says to run a release build when a package's output isn't there", async () => {
		const npmPublish = vi.spyOn(Npm.prototype, "publish");
		write({ exports: "./es6/gone.js" });

		await expect(publishing().run(options)).rejects.toThrow(
			"forge build --configuration release",
		);

		expect(npmPublish).not.toHaveBeenCalled();
	});
});
