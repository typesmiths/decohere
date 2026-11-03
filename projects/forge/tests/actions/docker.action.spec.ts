import { PackageJson, type Project, type Workspace } from "@decohere/workspace";
import { Docker as DockerInterop } from "@decohere/devkit/interop";
import { io } from "@decohere/core/io";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Docker } from "../../src/actions/docker.action.js";
import { Release } from "../../src/workspace.config.js";

const buildArgVersion = "$" + "{version}";
const envKeys = [
	"FORGE_DOCKER_BUILD_ARGS_JSON",
	"FORGE_DOCKER_SECRETS_JSON",
	"FORGE_DOCKER_EXTRA_TAGS_JSON",
	"FORGE_DOCKER_REGISTRY",
];

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(DockerInterop.prototype, "build").mockResolvedValue({ message: "built", data: [] });
	vi.spyOn(DockerInterop.prototype, "push").mockResolvedValue({ message: "pushed", data: [] });
	process.env.FORGE_DOCKER_BUILD_ARGS_JSON = JSON.stringify({ VERSION: buildArgVersion });
	process.env.FORGE_DOCKER_SECRETS_JSON = JSON.stringify({ npm_token: "NODE_AUTH_TOKEN" });
	process.env.FORGE_DOCKER_EXTRA_TAGS_JSON = JSON.stringify([
		"ghcr.io/typesmiths/decohere/create:latest",
	]);
	process.env.FORGE_DOCKER_REGISTRY = "ghcr.io";
});

afterEach(() => {
	for (const key of envKeys) {
		delete process.env[key];
	}
	vi.restoreAllMocks();
});

function createWorkspace(options: {
	projects: readonly Project[];
	packageJson: PackageJson;
	version: string;
}): Workspace {
	return {
		getProjects: vi.fn(() => options.projects),
		getPackageJson: vi.fn(async () => options.packageJson),
		getVersion: vi.fn(async () => options.version),
	} as unknown as Workspace;
}

it("builds and pushes configured docker projects using the workspace version", async () => {
	const buildSpy = vi.spyOn(DockerInterop.prototype, "build");
	const pushSpy = vi.spyOn(DockerInterop.prototype, "push");
	vi.spyOn(io, "fileExists").mockResolvedValue(true);

	const packageJson = new PackageJson({ name: "workspace", version: "1.2.3" });
	vi.spyOn(packageJson, "getRepositoryFullName").mockReturnValue("typesmiths/decohere");

	const project = {
		name: "@decohere/create",
		projectRoot: "/workspace/projects/create",
		dockerConfig: {},
	} as unknown as Project;

	const workspace = createWorkspace({
		projects: [project],
		packageJson,
		version: "1.2.3",
	});

	const action = new Docker(workspace);
	const response = await action.run({ configuration: Release.name, push: true });

	expect(response.data).toHaveLength(1);
	expect(buildSpy).toHaveBeenCalledWith(
		"/workspace/projects/create",
		expect.objectContaining({
			cwd: "/workspace/projects/create",
			dockerfile: "/workspace/projects/create/Dockerfile",
			tags: [
				"ghcr.io/typesmiths/decohere/create:1.2.3",
				"ghcr.io/typesmiths/decohere/create:latest",
			],
			buildArgs: { VERSION: "1.2.3" },
			secrets: { npm_token: "NODE_AUTH_TOKEN" },
		}),
	);
	expect(pushSpy).toHaveBeenCalledWith("ghcr.io/typesmiths/decohere/create:1.2.3", {
		cwd: "/workspace/projects/create",
	});
	expect(pushSpy).toHaveBeenCalledWith("ghcr.io/typesmiths/decohere/create:latest", {
		cwd: "/workspace/projects/create",
	});
});

it("applies FORGE_DOCKER_EXTRA_TAGS_JSON only to the matching image repository", async () => {
	const buildSpy = vi.spyOn(DockerInterop.prototype, "build");
	vi.spyOn(io, "fileExists").mockResolvedValue(true);

	const packageJson = new PackageJson({ name: "workspace", version: "1.2.3" });
	vi.spyOn(packageJson, "getRepositoryFullName").mockReturnValue("typesmiths/decohere");

	process.env.FORGE_DOCKER_EXTRA_TAGS_JSON = JSON.stringify([
		"ghcr.io/typesmiths/decohere/create:latest",
		"ghcr.io/typesmiths/decohere/devcontainer:latest",
	]);

	const workspace = createWorkspace({
		projects: [
			{
				name: "@decohere/create",
				projectRoot: "/workspace/projects/create",
				dockerConfig: { image: "ghcr.io/typesmiths/decohere/create" },
			} as unknown as Project,
			{
				name: "@decohere/devcontainer",
				projectRoot: "/workspace/projects/devcontainer",
				dockerConfig: { image: "ghcr.io/typesmiths/decohere/devcontainer" },
			} as unknown as Project,
		],
		packageJson,
		version: "1.2.3",
	});

	const action = new Docker(workspace);
	await action.run({ configuration: Release.name });

	expect(buildSpy).toHaveBeenCalledWith(
		"/workspace/projects/create",
		expect.objectContaining({
			tags: [
				"ghcr.io/typesmiths/decohere/create:1.2.3",
				"ghcr.io/typesmiths/decohere/create:latest",
			],
		}),
	);
	expect(buildSpy).toHaveBeenCalledWith(
		"/workspace/projects/devcontainer",
		expect.objectContaining({
			tags: [
				"ghcr.io/typesmiths/decohere/devcontainer:1.2.3",
				"ghcr.io/typesmiths/decohere/devcontainer:latest",
			],
		}),
	);
});

it("succeeds with an empty result when no project has a dockerfile", async () => {
	const buildSpy = vi.spyOn(DockerInterop.prototype, "build");
	vi.spyOn(io, "fileExists").mockResolvedValue(false);

	const workspace = createWorkspace({
		projects: [
			{
				name: "missing-dockerfile",
				projectRoot: "/workspace/projects/missing-dockerfile",
				dockerConfig: {
					image: "ghcr.io/decohere/missing",
					buildArgs: { VERSION: buildArgVersion },
				},
			} as unknown as Project,
		],
		packageJson: new PackageJson({ name: "workspace", version: "1.2.3" }),
		version: "1.2.3",
	});

	const action = new Docker(workspace);
	const response = await action.run({ configuration: Release.name });

	expect(response.succeeded).toBe(true);
	expect(response.data).toEqual([]);
	expect(buildSpy).not.toHaveBeenCalled();
});

it("fails dry-run when docker build fails", async () => {
	const pushSpy = vi.spyOn(DockerInterop.prototype, "push");
	vi.spyOn(DockerInterop.prototype, "build").mockRejectedValue(
		new Error("npm install of a private package failed"),
	);
	vi.spyOn(io, "fileExists").mockResolvedValue(true);

	const packageJson = new PackageJson({ name: "workspace", version: "1.2.3" });
	vi.spyOn(packageJson, "getRepositoryFullName").mockReturnValue("typesmiths/decohere");

	const workspace = createWorkspace({
		projects: [
			{
				name: "@decohere/create",
				projectRoot: "/workspace/projects/create",
				dockerConfig: {},
			} as unknown as Project,
		],
		packageJson,
		version: "1.2.3",
	});

	const action = new Docker(workspace);
	const response = await action.run({ configuration: Release.name, dryRun: true, push: true });

	expect(response.succeeded).toBe(false);
	expect(pushSpy).not.toHaveBeenCalled();
});

function packagedProject(): Project {
	return {
		name: "@app/api",
		projectRoot: "/workspace/projects/api",
		dockerConfig: {},
	} as unknown as Project;
}

function dockerWith(dockerfile: string, packageExists: boolean): Docker {
	vi.spyOn(io, "fileExists").mockImplementation(
		async (file) => packageExists || !file.endsWith(".package/package.json"),
	);
	vi.spyOn(io, "readFile").mockResolvedValue(dockerfile);
	return new Docker(
		createWorkspace({
			projects: [packagedProject()],
			packageJson: new PackageJson({ name: "workspace", version: "1.2.3" }),
			version: "1.2.3",
		}),
	);
}

it("fails before building when the Dockerfile copies .package/ and forge package has not run", async () => {
	const buildSpy = vi.spyOn(DockerInterop.prototype, "build");

	const response = await dockerWith("FROM node\nCOPY .package/ ./\n", false).run({
		configuration: Release.name,
	});

	expect(response.succeeded).toBe(false);
	expect(response.message).toContain("forge package @app/api");
	expect(buildSpy).not.toHaveBeenCalled();
});

it("builds when the Dockerfile copies .package/ and the package exists", async () => {
	const buildSpy = vi.spyOn(DockerInterop.prototype, "build");

	const response = await dockerWith("FROM node\nCOPY .package/ ./\n", true).run({
		configuration: Release.name,
	});

	expect(response.succeeded).toBe(true);
	expect(buildSpy).toHaveBeenCalledTimes(1);
});

it("does not require .package/ for a Dockerfile that does not use it", async () => {
	const buildSpy = vi.spyOn(DockerInterop.prototype, "build");

	const response = await dockerWith("FROM node\nCOPY dist ./dist\n", false).run({
		configuration: Release.name,
	});

	expect(response.succeeded).toBe(true);
	expect(buildSpy).toHaveBeenCalledTimes(1);
});
