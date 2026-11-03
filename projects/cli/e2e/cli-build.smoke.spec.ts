/**
 * Smoke: in-tree forge release build emits CLI package artifacts.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RELEASE_FORGE_OUT = path.join(WORKSPACE_ROOT, "dist/release/projects/forge");
const RELEASE_CLI_JS = path.join(WORKSPACE_ROOT, "dist/release/projects/cli/es6/src/cli.js");
const RELEASE_PACKAGE_JSON = path.join(RELEASE_FORGE_OUT, "package.json");
const NODE = process.execPath;

function run(command: string, args: string[], timeout: number) {
	return spawnSync(command, args, {
		cwd: WORKSPACE_ROOT,
		encoding: "utf8",
		timeout,
	});
}

function releasePath(relativePath: string) {
	return path.join(RELEASE_FORGE_OUT, relativePath.replace(/^\.\//, ""));
}

beforeAll(() => {
	const result = run(
		"pnpm",
		[
			"exec",
			"flux",
			"run",
			"projects/cli/src/forge.ts",
			"--",
			"--config-file",
			".decohere.js",
			"build",
			"--configuration",
			"release",
		],
		120_000,
	);
	if (result.status !== 0) {
		throw new Error(`forge release build failed:\n${result.stdout}\n${result.stderr}`);
	}
}, 120_000);

describe("forge release build output", () => {
	it("cli --help exits 0 and prints forge", () => {
		const result = run(NODE, [RELEASE_CLI_JS, "--help"], 15_000);
		expect(result.status).toBe(0);
		expect(`${result.stdout}${result.stderr}`).toContain("forge");
	});

	it("release package entrypoints and typings exist", () => {
		expect(existsSync(RELEASE_PACKAGE_JSON)).toBe(true);
		expect(existsSync(RELEASE_CLI_JS)).toBe(true);

		const packageJson = JSON.parse(readFileSync(RELEASE_PACKAGE_JSON, "utf8"));
		const rootExport = packageJson.exports["."];

		expect(existsSync(releasePath(rootExport.import))).toBe(true);
		expect(existsSync(releasePath(rootExport.require))).toBe(true);
		expect(existsSync(releasePath(rootExport.types))).toBe(true);
		expect(existsSync(releasePath("./types/src/actions/version.action.d.ts"))).toBe(true);
		expect(existsSync(releasePath("./types/src/commands/forge.command.d.ts"))).toBe(true);
	});
});
