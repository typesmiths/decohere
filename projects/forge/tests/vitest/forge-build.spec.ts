import { resetMemfs } from "@decohere/testing";
import { SourceMap } from "node:module";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwcTranspiler } from "../../src/services/swc-transpiler.js";
import { forgeBuild } from "../../src/vitest/forge-build.plugin.js";

vi.mock("fs");
vi.mock("fs/promises");
vi.mock("node:fs");
vi.mock("node:fs/promises");
vi.mock("glob", async () => {
	const actual = await vi.importActual<typeof import("glob")>("glob");
	const { withMemfsFsForGlob } = await import("@decohere/testing");
	return withMemfsFsForGlob(actual);
});

const mockFiles = {
	"/projects/test-proj/package.json": JSON.stringify({ name: "test-proj", version: "1.0.0" }),
	"/projects/test-proj/src/index.ts": "export const value: number = 1;",
	"/projects/test-proj/src/dep.ts": "export const dep = 1;",
};

const singleFileMockFiles = {
	"/projects/test-proj/package.json": JSON.stringify({ name: "test-proj", version: "1.0.0" }),
	"/projects/test-proj/src/index.ts": "export const value: number = 1;",
};

const aliasFiles = {
	"/projects/lib-a/package.json": JSON.stringify({ name: "lib-a", version: "1.0.0" }),
	"/projects/lib-a/src/index.ts": "export const value = 42;",
	"/projects/app/package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
	"/projects/app/src/index.ts": 'export { value } from "@MOCK/liba";',
	"/tsconfig.json": JSON.stringify({
		compilerOptions: {
			baseUrl: ".",
			paths: { "@MOCK/liba": ["projects/lib-a/src/index.ts"] },
		},
	}),
};

describe("forgeBuild", () => {
	beforeEach(() => {
		resetMemfs();
		vi.clearAllMocks();
		vi.restoreAllMocks();
		vi.spyOn(process, "cwd").mockReturnValue("/");
	});

	afterEach(() => {
		resetMemfs();
	});

	it("transforms TypeScript through real Forge build integration", async () => {
		vol.fromJSON(mockFiles);
		const plugin = forgeBuild({
			workspaceRoot: "/",
			buildConfig: "debug",
			logLevel: "silent",
		});

		const result = await plugin.transform(
			"export const value: number = 1;",
			"/projects/test-proj/src/index.ts",
		);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("export const value = 1");
		expect(result?.code).not.toContain(": number");
	});

	it("resolves .js relative imports to existing TypeScript files", () => {
		vol.fromJSON(mockFiles);
		const plugin = forgeBuild({
			workspaceRoot: "/",
			buildConfig: "debug",
			logLevel: "silent",
		});

		const resolved = plugin.resolveId("./dep.js", "/projects/test-proj/src/index.ts");

		expect(resolved).toBe("/projects/test-proj/src/dep.ts");
	});

	it("returns cached result on second transform call without invoking SWC again", async () => {
		vol.fromJSON(singleFileMockFiles);
		const transformSpy = vi.spyOn(SwcTranspiler.prototype, "transformCode");
		const plugin = forgeBuild({
			workspaceRoot: "/",
			buildConfig: "debug",
			logLevel: "silent",
		});
		const source = "export const value: number = 1;";
		const file = "/projects/test-proj/src/index.ts";

		const first = await plugin.transform(source, file);
		const second = await plugin.transform(source, file);

		expect(transformSpy).toHaveBeenCalledTimes(1);
		expect(second).toEqual(first);
	});

	it("rewrites @MOCK/liba path alias to a relative import using tsconfig paths", async () => {
		vol.fromJSON(aliasFiles);
		const plugin = forgeBuild({
			workspaceRoot: "/",
			buildConfig: "debug",
			logLevel: "silent",
		});

		const result = await plugin.transform(
			'export { value } from "@MOCK/liba";',
			"/projects/app/src/index.ts",
		);

		expect(result).not.toBeNull();
		expect(result?.code).not.toContain("@MOCK/liba");
		expect(result?.code).toContain("lib-a/src/index");
	});

	// The plugin compiled the project's files ahead (pre-warm), reading them from disk
	// into a content cache; the first transform of a file then compiled that earlier read
	// instead of the code Vite passed, so an edit in between ran the old code.
	it("compiles the code Vite passes, not an earlier read of the file", async () => {
		vol.fromJSON(mockFiles);
		const transformProject = vi.spyOn(SwcTranspiler.prototype, "transformProject");
		const plugin = forgeBuild({
			workspaceRoot: "/",
			buildConfig: "debug",
			logLevel: "silent",
		});

		await plugin.transform(
			mockFiles["/projects/test-proj/src/index.ts"],
			"/projects/test-proj/src/index.ts",
		);
		await Promise.all(transformProject.mock.results.map((r) => r.value));
		vol.writeFileSync("/projects/test-proj/src/dep.ts", "export const dep = 2;");
		const result = await plugin.transform(
			"export const dep = 2;",
			"/projects/test-proj/src/dep.ts",
		);

		expect(result?.code).toContain("dep = 2");
	});

	// Stack traces and coverage lines in tests come from this map: Vite reads the inline
	// map in the compiled code. TypeScript-only lines above the throw move it in the output.
	it("maps compiled code back to the TypeScript source lines", async () => {
		vol.fromJSON(singleFileMockFiles);
		const plugin = forgeBuild({
			workspaceRoot: "/",
			buildConfig: "debug",
			logLevel: "silent",
		});
		const source = [
			"interface Point {",
			"	x: number;",
			"}",
			"type Id = string;",
			"export function fail(point: Point, id: Id): never {",
			"	throw new Error(`${point.x} ${id}`);",
			"}",
		].join("\n");

		const result = await plugin.transform(source, "/projects/test-proj/src/index.ts");

		const code = result?.code ?? "";
		const inline = code.match(/sourceMappingURL=data:application\/json;base64,(\S+)/)?.[1];
		expect(inline, "inline source map").toBeDefined();
		const map = new SourceMap(
			JSON.parse(Buffer.from(inline ?? "", "base64").toString("utf8")),
		);
		const lines = code.split("\n");
		const throwLine = lines.findIndex((line) => line.includes("throw new Error"));
		expect(throwLine).toBeLessThan(5);
		const entry = map.findEntry(throwLine, lines[throwLine]?.indexOf("throw") ?? 0);
		expect(entry).toMatchObject({ originalLine: 5 });
	});

	it("applies the project's .swcrc", async () => {
		vol.fromJSON({
			...singleFileMockFiles,
			"/projects/test-proj/.swcrc": JSON.stringify({ jsc: { target: "es2019" } }),
		});
		const plugin = forgeBuild({
			workspaceRoot: "/",
			buildConfig: "debug",
			logLevel: "silent",
		});

		const result = await plugin.transform(
			"export const value = (a?: number) => a ?? 1;",
			"/projects/test-proj/src/index.ts",
		);

		// es2019 has no `??`, so SWC rewrites it.
		expect(result?.code).not.toContain("??");
	});
});
