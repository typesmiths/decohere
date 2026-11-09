import path from "node:path";
import { describe, expect, it } from "vitest";
import { packageScriptPath } from "../../src/interop/scripts/package-script.js";

describe("packageScriptPath", () => {
	it("puts each node_modules/.bin from the project up to the workspace root before PATH", () => {
		const root = path.resolve("/ws");
		const entries = packageScriptPath(
			{ cwd: path.join(root, "projects/site/web"), script: "build", workspaceRoot: root },
			"/usr/bin",
		).split(path.delimiter);

		expect(entries).toEqual([
			path.join(root, "projects/site/web/node_modules/.bin"),
			path.join(root, "projects/site/node_modules/.bin"),
			path.join(root, "projects/node_modules/.bin"),
			path.join(root, "node_modules/.bin"),
			"/usr/bin",
		]);
	});

	it("stops at the workspace root", () => {
		const root = path.resolve("/ws");
		const entries = packageScriptPath(
			{ cwd: root, script: "build", workspaceRoot: root },
			"",
		).split(path.delimiter);

		expect(entries).toEqual([path.join(root, "node_modules/.bin")]);
	});
});
