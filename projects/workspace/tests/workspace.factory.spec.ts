import { WorkspaceFactory, type WorkspaceOptions } from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const root = "/MOCK_ROOT";
const projects = "projects";
const projPath = `${projects}/path/to`;
const projPath2 = `${projects}/path/other`;
const MOCK_PROJ1 = "MOCK_PROJ1";
const MOCK_PROJ2 = "MOCK_PROJ2";

const defaultOptions: WorkspaceOptions = {
	rootDir: root,
	outDir: "dist",
	includeProjects: ["projects/**/package.json"],
	ignoreProjects: ["**/node_modules/**", "**/__fixtures__/**"],
	copyFiles: [],
	configurations: [{ name: "debug" }],
};

const mockFiles = {
	[`${root}/package.json`]: JSON.stringify({ name: "ROOT" }),
	[`${root}/${projPath}/package.json`]: JSON.stringify({ name: MOCK_PROJ1 }),
	[`${root}/${projPath}/src/index.ts`]: "export const value = 1;",
	[`${root}/${projPath2}/package.json`]: JSON.stringify({ name: MOCK_PROJ2 }),
} satisfies Record<string, string>;

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue(root);
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

it("creates a workspace and discovers projects", async () => {
	vol.fromJSON(mockFiles);
	const workspace = await WorkspaceFactory.create(defaultOptions);
	expect(workspace.getProjects("debug")).toHaveLength(2);
});

it("ignores node_modules", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${root}/${projPath}/node_modules/foo/package.json`]: JSON.stringify({ name: "LIB" }),
	});
	const workspace = await WorkspaceFactory.create(defaultOptions);
	expect(workspace.getProjects("debug")).toHaveLength(2);
});

it("ignores fixture folders", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${root}/${projPath}/__fixtures__/foo/package.json`]: JSON.stringify({ name: "LIB" }),
	});
	const workspace = await WorkspaceFactory.create(defaultOptions);
	expect(workspace.getProjects("debug")).toHaveLength(2);
});

it("creates workspace projects with expected directories", async () => {
	vol.fromJSON(mockFiles);
	const workspace = await WorkspaceFactory.create(defaultOptions);
	const projectNamesToDirs = workspace
		.getProjects("debug")
		.map((p) => [p.name, p.projectDirectory] as const);

	expect(projectNamesToDirs).toEqual(
		expect.arrayContaining([
			[MOCK_PROJ1, projPath],
			[MOCK_PROJ2, projPath2],
		]),
	);
});

it("throws when duplicate project names exist", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${root}/${projects}/duplicate/package.json`]: JSON.stringify({ name: MOCK_PROJ1 }),
	});

	await expect(() => WorkspaceFactory.create(defaultOptions)).rejects.toThrow();
});

it("creates a project with default include when no options are passed (flux path)", async () => {
	const root = "/FLUX_ROOT";
	vol.fromJSON({
		[`${root}/projects/app/package.json`]: JSON.stringify({
			name: "my-app",
			main: "src/index.ts",
		}),
		[`${root}/projects/app/src/index.ts`]: "export default {};",
	});
	vi.spyOn(process, "cwd").mockReturnValue(root);

	// FluxModule.createWorkspace calls WorkspaceFactory.create({ configFile: undefined })
	// — the workspace package's WorkspaceDefaults provides the TypeScript includes, so fileInfoMap is populated.
	const workspace = await WorkspaceFactory.create({ configFile: undefined, rootDir: root });
	const projects = workspace.getProjects("debug");

	expect(projects).toHaveLength(1);
	expect(projects[0].include).toEqual(["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"]);
});

it("fires projectFileChanged$ when a source file is written after watch starts", async () => {
	const root = "/WATCH_ROOT";
	const filePath = `${root}/projects/app/src/index.ts`;
	vol.fromJSON({
		[`${root}/projects/app/package.json`]: JSON.stringify({
			name: "watch-app",
			main: "src/index.ts",
		}),
		[filePath]: "export const v = 1;",
	});
	vi.spyOn(process, "cwd").mockReturnValue(root);

	const workspace = await WorkspaceFactory.create({ configFile: undefined, rootDir: root });

	// workspace.watch() calls project.watch() internally and subscribes project events
	// into workspace.projectFileChanged$
	await workspace.watch("debug");

	const [project] = workspace.getProjects("debug");

	await new Promise<void>((resolve, reject) => {
		const subscription = workspace.projectFileChanged$.subscribe((evt) => {
			if (evt.file.relativePath !== "src/index.ts") return;
			subscription.unsubscribe();
			workspace.stopWatching();
			resolve();
		});

		// project.watch() was already called by workspace.watch(); use its ready promise
		project.watch("debug").then((watcher) => {
			watcher.ready.then(() => {
				fs.writeFileSync(filePath, "export const v = 2;", { encoding: "utf8" });
			});
		});

		setTimeout(() => {
			subscription.unsubscribe();
			workspace.stopWatching();
			reject(new Error("projectFileChanged$ did not fire within timeout"));
		}, 800);
	});
});
