/**
 * Smoke: the release build in dist/release has the CLI's package artifacts. It tests the build that's
 * there rather than making one, because CI runs this on the build it's about to publish. Locally,
 * run `pnpm forge build --configuration release` first. The real-install spec runs the installed CLI.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RELEASE_FORGE_OUT = path.join(WORKSPACE_ROOT, "dist/release/projects/forge");
const RELEASE_CLI_JS = path.join(WORKSPACE_ROOT, "dist/release/projects/cli/es6/src/cli.js");
const RELEASE_PACKAGE_JSON = path.join(RELEASE_FORGE_OUT, "package.json");

function releasePath(relativePath: string) {
	return path.join(RELEASE_FORGE_OUT, relativePath.replace(/^\.\//, ""));
}

describe("forge release build output", () => {
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
