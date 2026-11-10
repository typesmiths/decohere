import { describe, expect, it } from "vitest";
import { PackageJson } from "../src/models/package-json.model.js";
import { Project } from "../src/models/project.model.js";
import { projectScripts } from "../src/models/project-scripts.js";

describe("projectScripts.getOwn", () => {
	it("is the project's own command for the step", () => {
		expect(projectScripts.getOwn({ build: "astro build" }, "build")).toBe("astro build");
	});

	it("is undefined when the project declares no such script", () => {
		expect(projectScripts.getOwn({ dev: "astro dev" }, "build")).toBeUndefined();
		expect(projectScripts.getOwn(undefined, "build")).toBeUndefined();
		expect(projectScripts.getOwn({ build: "  " }, "build")).toBeUndefined();
	});

	it("leaves a script that calls a Decohere tool to that tool", () => {
		expect(projectScripts.getOwn({ build: "forge build" }, "build")).toBeUndefined();
		expect(projectScripts.getOwn({ dev: "flux serve --project api" }, "dev")).toBeUndefined();
		expect(
			projectScripts.getOwn({ check: "pnpm decohere typecheck" }, "check"),
		).toBeUndefined();
	});

	it("doesn't mistake a word that only contains a tool's name", () => {
		expect(projectScripts.getOwn({ build: "reforged build" }, "build")).toBe("reforged build");
	});
});

describe("Project.getOwnScript", () => {
	it("reads the project's package.json", () => {
		const packageJson = new PackageJson({
			name: "@app/site",
			scripts: { build: "vite build" },
		});
		const project = new Project("@app/site", {
			projectDir: "projects/site",
			packageJson,
			outDir: "dist",
			includeProjects: [],
			ignoreProjects: [],
			copyFiles: [],
			configurations: [{ name: "debug" }],
		});

		expect(project.getOwnScript("build")).toBe("vite build");
		expect(project.getOwnScript("check")).toBeUndefined();
	});
});
