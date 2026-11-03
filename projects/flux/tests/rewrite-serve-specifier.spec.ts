import path from "node:path";
import { pathToFileURL } from "node:url";
import { packageAliases } from "@decohere/workspace";
import { describe, expect, it } from "vitest";
import { rewriteServeSpecifier } from "../src/rewrite-serve-specifier.js";

const parentDir = "/workspace/projects/app";
const parentUrl = pathToFileURL(path.join(parentDir, "main.ts")).toString();
const depTs = path.join(parentDir, "dep-a.ts");
const libTs = "/workspace/projects/lib/src/index.ts";
const libOtherTs = "/workspace/projects/lib/src/other.ts";
const modelsIndexTs = path.join(parentDir, "models", "index.ts");
const libModelsIndexTs = "/workspace/projects/lib/src/models/index.ts";

const watched = new Set([depTs, libTs, libOtherTs, modelsIndexTs, libModelsIndexTs]);
const aliasPaths = {
	"@hmr/lib": ["projects/lib/src/index.ts"],
	"@hmr/lib/*": ["projects/lib/src/*"],
};

function version(fileUrl: string) {
	return `${fileUrl}?version=1`;
}

function rewrite(specifier: string, parent = parentUrl) {
	return rewriteServeSpecifier({
		specifier,
		parentUrl: parent,
		isWatchedTs: (filePath) => watched.has(filePath),
		resolveBare: (bare) => packageAliases.resolvePath(bare, aliasPaths, "/workspace"),
		versionFileUrl: version,
	});
}

describe("rewriteServeSpecifier", () => {
	it("versions relative .js specifiers that map to a watched .ts file", () => {
		expect(rewrite("./dep-a.js")).toBe(`${pathToFileURL(depTs).toString()}?version=1`);
	});

	it("versions relative .ts specifiers that are watched", () => {
		expect(rewrite("./dep-a.ts")).toBe(`${pathToFileURL(depTs).toString()}?version=1`);
	});

	it("versions extensionless relative specifiers that map to a watched .ts file", () => {
		expect(rewrite("./dep-a")).toBe(`${pathToFileURL(depTs).toString()}?version=1`);
	});

	it("versions bare workspace package names for dynamic import()", () => {
		expect(rewrite("@hmr/lib")).toBe(`${pathToFileURL(libTs).toString()}?version=1`);
	});

	it("versions bare workspace package subpaths", () => {
		expect(rewrite("@hmr/lib/other")).toBe(
			`${pathToFileURL(libOtherTs).toString()}?version=1`,
		);
	});

	// SWC's resolveFully used to turn `./models` into `./models/index.js`; flux no longer asks SWC
	// to resolve imports, so the resolve hook finds the index itself.
	it("versions a relative directory import as its index.ts", () => {
		const expected = `${pathToFileURL(modelsIndexTs).toString()}?version=1`;
		expect(rewrite("./models")).toBe(expected);
		expect(rewrite("./models/")).toBe(expected);
		expect(rewrite("./models/index.js")).toBe(expected);
	});

	it("versions a bare package subpath that names a directory as its index.ts", () => {
		expect(rewrite("@hmr/lib/models")).toBe(
			`${pathToFileURL(libModelsIndexTs).toString()}?version=1`,
		);
	});

	it("prefers a file over a directory index of the same name", () => {
		expect(rewrite("./dep-a")).toBe(`${pathToFileURL(depTs).toString()}?version=1`);
	});

	it("leaves builtins, unknown packages, hash specifiers, and already-absolute URLs alone", () => {
		expect(rewrite("node:fs")).toBeNull();
		expect(rewrite("memfs")).toBeNull();
		expect(rewrite("@other/pkg")).toBeNull();
		expect(rewrite("#internal")).toBeNull();
		expect(rewrite(pathToFileURL(depTs).toString())).toBeNull();
		expect(rewrite("data:text/javascript,export default 1")).toBeNull();
	});

	it("leaves relative specifiers that are not watched .ts files alone", () => {
		expect(rewrite("./missing.js")).toBeNull();
		expect(rewrite("./missing.ts")).toBeNull();
		expect(rewrite("./missing")).toBeNull();
	});

	it("strips a version query from the parent URL before resolving relatives", () => {
		const versionedParent = `${parentUrl}?version=99`;
		expect(rewrite("./dep-a.js", versionedParent)).toBe(
			`${pathToFileURL(depTs).toString()}?version=1`,
		);
	});

	it("versions an absolute path that maps to a watched .ts file", () => {
		expect(rewrite(depTs)).toBe(`${pathToFileURL(depTs).toString()}?version=1`);
	});
});
