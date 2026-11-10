import { describe, expect, it } from "vitest";
import { PackageJson } from "../src/models/package-json.model.js";
import { Project } from "../src/models/project.model.js";
import { projectScripts } from "../src/models/project-scripts.js";

describe("projectScripts.own", () => {
	it("is the project's own command for the step", () => {
		expect(projectScripts.own({ build: "astro build" }, "build")).toBe("astro build");
	});

	it("is undefined when the project declares no such script", () => {
		expect(projectScripts.own({ dev: "astro dev" }, "build")).toBeUndefined();
		expect(projectScripts.own(undefined, "build")).toBeUndefined();
		expect(projectScripts.own({ build: "  " }, "build")).toBeUndefined();
	});

	it("leaves a script that calls a Decohere tool to that tool", () => {
		expect(projectScripts.own({ build: "forge build" }, "build")).toBeUndefined();
		expect(projectScripts.own({ dev: "flux serve --project api" }, "dev")).toBeUndefined();
		expect(projectScripts.own({ check: "pnpm decohere typecheck" }, "check")).toBeUndefined();
	});

	it("doesn't mistake a word that only contains a tool's name", () => {
		expect(projectScripts.own({ build: "reforged build" }, "build")).toBe("reforged build");
	});
});

describe("Project.ownScript", () => {
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

		expect(project.ownScript("build")).toBe("vite build");
		expect(project.ownScript("check")).toBeUndefined();
	});
});
