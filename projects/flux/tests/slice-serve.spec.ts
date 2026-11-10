import { describe, expect, it } from "vitest";
import {
	classifySliceProject,
	classifySliceProjects,
	isFluxAppMain,
	isUnderSlice,
	normalizeSlicePrefix,
	projectsInSlice,
	resolveDeferScript,
	type SliceProjectView,
} from "../src/slice-serve.js";

function view(
	partial: Partial<SliceProjectView> & Pick<SliceProjectView, "name">,
): SliceProjectView {
	return {
		projectDirectory: partial.projectDirectory ?? `projects/${partial.name}`,
		main: partial.main ?? "src/index.ts",
		scripts: partial.scripts ?? {},
		...partial,
		name: partial.name,
	};
}

describe("normalizeSlicePrefix", () => {
	it("prefixes bare module names with projects/", () => {
		expect(normalizeSlicePrefix("funding")).toBe("projects/funding");
	});

	it("keeps an explicit projects/ path", () => {
		expect(normalizeSlicePrefix("projects/funding")).toBe("projects/funding");
	});

	it("strips trailing slashes", () => {
		expect(normalizeSlicePrefix("funding/")).toBe("projects/funding");
	});

	it("rejects empty input", () => {
		expect(() => normalizeSlicePrefix("")).toThrow(/non-empty/);
		expect(() => normalizeSlicePrefix(".")).toThrow(/non-empty/);
	});
});

describe("isUnderSlice", () => {
	it("matches the slice root and descendants", () => {
		expect(isUnderSlice("projects/funding", "projects/funding")).toBe(true);
		expect(isUnderSlice("projects/funding/api", "projects/funding")).toBe(true);
	});

	it("does not match a sibling that only shares a string prefix", () => {
		expect(isUnderSlice("projects/funding-fee.api", "projects/funding")).toBe(false);
	});

	it("matches flat dotted package dirs for the module token", () => {
		expect(isUnderSlice("projects/shell.web", "projects/shell")).toBe(true);
		expect(isUnderSlice("projects/funding.web", "projects/funding")).toBe(true);
		expect(isUnderSlice("projects/funding.domain", "projects/funding")).toBe(true);
	});
});

describe("projectsInSlice", () => {
	const projects = [
		view({ name: "api", projectDirectory: "projects/funding/api" }),
		view({ name: "web", projectDirectory: "projects/funding/web" }),
		view({ name: "other", projectDirectory: "projects/billing/api" }),
	];

	it("filters by bare slice name", () => {
		expect(projectsInSlice(projects, "funding").map((p) => p.name)).toEqual(["api", "web"]);
	});

	it("filters by projects/ slice path", () => {
		expect(projectsInSlice(projects, "projects/funding").map((p) => p.name)).toEqual([
			"api",
			"web",
		]);
	});
});

describe("resolveDeferScript", () => {
	it("prefers dev over serve when neither is Flux-owned", () => {
		expect(resolveDeferScript({ serve: "vite", dev: "vite" })).toBe("dev");
	});

	it("skips Flux-owned scripts and falls through", () => {
		expect(resolveDeferScript({ dev: "flux serve --project api", serve: "vite" })).toBe(
			"serve",
		);
	});

	it("leaves a script that calls forge or decohere to Flux too", () => {
		expect(resolveDeferScript({ dev: "forge build --watch" })).toBeUndefined();
		expect(resolveDeferScript({ dev: "decohere dev" })).toBeUndefined();
	});

	it("returns undefined when only Flux scripts exist", () => {
		expect(resolveDeferScript({ dev: "flux serve --project api" })).toBeUndefined();
	});
});

describe("isFluxAppMain", () => {
	it("accepts main.ts / main.tsx at any depth", () => {
		expect(isFluxAppMain("main.ts")).toBe(true);
		expect(isFluxAppMain("src/main.ts")).toBe(true);
		expect(isFluxAppMain("src/main.tsx")).toBe(true);
	});

	it("rejects library index entries", () => {
		expect(isFluxAppMain("src/index.ts")).toBe(false);
		expect(isFluxAppMain("index.ts")).toBe(false);
	});
});

describe("classifySliceProject", () => {
	it("defers when a foreign serve script is present even if main is main.ts", () => {
		expect(
			classifySliceProject(
				view({
					name: "web",
					main: "src/main.ts",
					scripts: { dev: "vite" },
				}),
			),
		).toBe("defer");
	});

	it("classifies main.ts without foreign scripts as flux", () => {
		expect(classifySliceProject(view({ name: "api", main: "src/main.ts", scripts: {} }))).toBe(
			"flux",
		);
	});

	it("skips libraries", () => {
		expect(
			classifySliceProject(view({ name: "domain", main: "src/index.ts", scripts: {} })),
		).toBe("skip");
	});

	it("keeps Flux-scripted apps on the flux path", () => {
		expect(
			classifySliceProject(
				view({
					name: "api",
					main: "src/main.ts",
					scripts: { dev: "flux serve --project api" },
				}),
			),
		).toBe("flux");
	});
});

describe("classifySliceProjects", () => {
	it("partitions a module directory into flux, defer, and skip", () => {
		const result = classifySliceProjects(
			[
				view({
					name: "api",
					projectDirectory: "projects/funding/api",
					main: "src/main.ts",
				}),
				view({
					name: "svc",
					projectDirectory: "projects/funding/svc-settlement",
					main: "src/main.ts",
				}),
				view({
					name: "web",
					projectDirectory: "projects/funding/web",
					main: "src/main.ts",
					scripts: { dev: "vite" },
				}),
				view({
					name: "domain",
					projectDirectory: "projects/funding/domain",
					main: "src/index.ts",
				}),
				view({
					name: "billing",
					projectDirectory: "projects/billing/api",
					main: "src/main.ts",
				}),
			],
			"funding",
		);

		expect(result.flux.map((p) => p.name)).toEqual(["api", "svc"]);
		expect(result.defer.map((p) => p.name)).toEqual(["web"]);
		expect(result.skip.map((p) => p.name)).toEqual(["domain"]);
	});

	it("unions multiple slice tokens (nested + flat)", () => {
		const result = classifySliceProjects(
			[
				view({
					name: "shell",
					projectDirectory: "projects/shell.web",
					main: "src/main.ts",
					scripts: { dev: "vite" },
				}),
				view({
					name: "funding-web",
					projectDirectory: "projects/funding.web",
					main: "src/main.ts",
					scripts: { serve: "vite preview" },
				}),
				view({
					name: "secmaster",
					projectDirectory: "projects/secmaster.web",
					main: "src/main.ts",
					scripts: { dev: "vite" },
				}),
				view({
					name: "funding-api",
					projectDirectory: "projects/funding/api",
					main: "src/main.ts",
				}),
				view({
					name: "other",
					projectDirectory: "projects/billing.web",
					main: "src/main.ts",
					scripts: { dev: "vite" },
				}),
			],
			["shell", "funding", "secmaster"],
		);

		expect(result.flux.map((p) => p.name)).toEqual(["funding-api"]);
		expect(result.defer.map((p) => p.name).sort()).toEqual([
			"funding-web",
			"secmaster",
			"shell",
		]);
		expect(result.skip).toEqual([]);
	});
});
