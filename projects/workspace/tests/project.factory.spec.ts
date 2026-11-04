import { ProjectFactory, WorkspaceDefaults, type WorkspaceOptions } from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";

const baseOptions: WorkspaceOptions = {
	rootDir: ".",
	outDir: "dist",
	includeProjects: ["projects/**/package.json"],
	ignoreProjects: ["**/node_modules/**", "**/__fixtures__/**"],
	copyFiles: [],
	configurations: [{ name: "debug" }],
};

afterEach(() => {
	resetMemfs();
});

it("builds projects from discovered package.json files", async () => {
	vol.fromJSON({
		"projects/path/to/nested1/package.json": JSON.stringify({ name: "MOCK_PROJ" }),
		"projects/path/to/nested2/package.json": JSON.stringify({ name: "MOCK_PROJ2" }),
	});

	const projects = await ProjectFactory.getProjects(baseOptions, "debug");
	expect(projects).toHaveLength(2);
	expect(projects.map((p) => p.name)).toEqual(["MOCK_PROJ", "MOCK_PROJ2"]);
});

it("detects projects using include patterns", async () => {
	vol.fromJSON({
		"projects/package.json": JSON.stringify({ name: "NOT_INCLUDED" }),
		"MOCK_DIR/package.json": JSON.stringify({ name: "MOCK_PROJ1" }),
		"MOCK_DIR1/package.json": JSON.stringify({ name: "MOCK_PROJ2" }),
	});

	const config: WorkspaceOptions = {
		...baseOptions,
		includeProjects: ["MOCK_DIR/**", "MOCK_DIR1/**"],
	};
	const projects = await ProjectFactory.getProjects(config, "debug");
	expect(projects).toHaveLength(2);
	expect(projects).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ name: "MOCK_PROJ1" }),
			expect.objectContaining({ name: "MOCK_PROJ2" }),
		]),
	);
});

it("ignores projects when ignore patterns overlap include patterns", async () => {
	vol.fromJSON({
		"MOCK_DIR/package.json": JSON.stringify({ name: "MOCK_PROJ" }),
		"MOCK_DIR/IGNORE/package.json": JSON.stringify({ name: "IGNORE" }),
		"MOCK_DIR/IGNORE1/package.json": JSON.stringify({ name: "IGNORE" }),
	});

	const config: WorkspaceOptions = {
		...baseOptions,
		includeProjects: ["MOCK_DIR/**"],
		ignoreProjects: ["MOCK_DIR/IGNORE/**", "MOCK_DIR/IGNORE1/**"],
	};
	const projects = await ProjectFactory.getProjects(config, "debug");
	expect(projects).toHaveLength(1);
	expect(projects[0]?.name).toBe("MOCK_PROJ");
});

it("ignores projects by exact file path", async () => {
	vol.fromJSON({
		"MOCK_DIR/package.json": JSON.stringify({ name: "MOCK_PROJ1" }),
		"MOCK_DIR/IGNORE/PROJ_1/package.json": JSON.stringify({ name: "MOCK_PROJ2" }),
		"MOCK_DIR/IGNORE/PROJ_2/package.json": JSON.stringify({ name: "IGNORED" }),
	});

	const config: WorkspaceOptions = {
		...baseOptions,
		includeProjects: ["MOCK_DIR/**"],
		ignoreProjects: ["MOCK_DIR/IGNORE/PROJ_2/package.json"],
	};
	const projects = await ProjectFactory.getProjects(config, "debug");
	expect(projects).toHaveLength(1);
	expect(projects.map((p) => p.name)).toEqual(["MOCK_PROJ1"]);
});

it("excludes package.json nested under another package.json", async () => {
	vol.fromJSON({
		"projects/root/package.json": JSON.stringify({ name: "ROOT" }),
		"projects/root/fixtures/bench/lib-a/package.json": JSON.stringify({ name: "BENCH_A" }),
		"projects/root/fixtures/bench/lib-b/package.json": JSON.stringify({ name: "BENCH_B" }),
		"projects/standalone/package.json": JSON.stringify({ name: "STANDALONE" }),
	});

	const config: WorkspaceOptions = {
		...baseOptions,
		includeProjects: ["projects/**/package.json"],
	};
	const projects = await ProjectFactory.getProjects(config, "debug");

	expect(projects.map((p) => p.name)).toEqual(["ROOT", "STANDALONE"]);
});

describe("a folder without projects/ (standalone)", () => {
	const defaults: WorkspaceOptions = { ...WorkspaceDefaults, rootDir: "." };

	it("makes the root package.json the one project, at the root", async () => {
		vol.fromJSON({
			"package.json": JSON.stringify({ name: "solo", main: "src/main.ts" }),
			"src/main.ts": "export {};",
		});

		const projects = await ProjectFactory.getProjects(defaults, "debug");

		expect(projects.map((p) => [p.name, p.projectDirectory])).toEqual([["solo", "."]]);
	});

	it("leaves build output, .git and node_modules out of its sources", async () => {
		vol.fromJSON({
			"package.json": JSON.stringify({ name: "solo" }),
			"src/main.ts": "export {};",
			"dist/debug/src/main.ts": "export {};",
			".git/hooks/x.ts": "export {};",
			"node_modules/dep/index.ts": "export {};",
		});

		const [project] = await ProjectFactory.getProjects(defaults, "debug");
		const files = (await project?.getAllFiles())?.map((f) =>
			f.relativePath.replaceAll("\\", "/"),
		);

		expect(files).toEqual(["src/main.ts"]);
	});

	it("stays a monorepo, with no projects, when a projects/ folder exists", async () => {
		vol.fromJSON({ "package.json": JSON.stringify({ name: "root" }), "projects/.keep": "" });

		expect(await ProjectFactory.getProjects(defaults, "debug")).toEqual([]);
	});

	it("respects an includeProjects of the user's own that finds nothing", async () => {
		vol.fromJSON({ "package.json": JSON.stringify({ name: "root" }) });

		const custom = { ...defaults, includeProjects: ["packages/**/package.json"] };
		expect(await ProjectFactory.getProjects(custom, "debug")).toEqual([]);
	});
});
