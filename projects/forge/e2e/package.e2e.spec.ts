/**
 * `forge package` on a real multi-package workspace: a deployable that imports a workspace
 * library (through a subpath export) which imports a third-party package. The packaged folder
 * must hold no symlinks and must run with plain `node`.
 *
 * Needs the npm registry (the packager runs a real `npm install` for `ms` and `is-number`).
 */

import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"__fixtures__/workspace",
);
const FORGE_ARGS = [
	"--import",
	path.join(REPO_ROOT, "tools/register.mjs"),
	path.join(REPO_ROOT, "projects/cli/src/forge.ts"),
];

let workspace: string;
let packaged: string;

function forge(...args: string[]) {
	return spawnSync(process.execPath, [...FORGE_ARGS, ...args], {
		cwd: workspace,
		encoding: "utf8",
		timeout: 100_000,
	});
}

/** Every path under `dir`, found with lstat so a symlink is seen as a link, not followed. */
function symlinksUnder(dir: string): string[] {
	const found: string[] = [];
	for (const name of readdirSync(dir)) {
		const entry = path.join(dir, name);
		const stats = lstatSync(entry);
		if (stats.isSymbolicLink()) {
			found.push(entry);
		} else if (stats.isDirectory()) {
			found.push(...symlinksUnder(entry));
		}
	}
	return found;
}

beforeAll(() => {
	// Outside the repo, so nothing here can resolve through the repo's own node_modules.
	workspace = mkdtempSync(path.join(tmpdir(), "forge-package-"));
	cpSync(FIXTURE, workspace, { recursive: true });
	// The version the workspace "installed": the packager pins the app to it.
	for (const [name, version] of [
		["ms", "2.1.3"],
		["is-number", "7.0.0"],
	]) {
		mkdirSync(path.join(workspace, "node_modules", name), { recursive: true });
		writeFileSync(
			path.join(workspace, "node_modules", name, "package.json"),
			JSON.stringify({ name, version }),
		);
	}

	const build = forge("build", "--configuration", "release");
	if (build.status !== 0) {
		throw new Error(`forge release build failed:\n${build.stdout}\n${build.stderr}`);
	}
	const result = forge("package", "@fixture/shop.api");
	if (result.status !== 0) {
		throw new Error(`forge package failed:\n${result.stdout}\n${result.stderr}`);
	}
	packaged = path.join(workspace, "projects/shop.api/.package");
}, 180_000);

afterAll(() => {
	rmSync(workspace, { recursive: true, force: true });
});

describe("forge package on a multi-package workspace", () => {
	it("holds no symlinks anywhere in the output", () => {
		expect(existsSync(path.join(packaged, "node_modules/ms/package.json"))).toBe(true);
		expect(symlinksUnder(packaged)).toEqual([]);
	});

	it("runs with plain node from the packaged folder", () => {
		const run = spawnSync(process.execPath, ["es6/src/main.js"], {
			cwd: packaged,
			encoding: "utf8",
			timeout: 20_000,
			env: { PATH: process.env.PATH, NODE_ENV: "production" },
		});

		expect(run.stderr).toBe("");
		expect(run.status).toBe(0);
		expect(JSON.parse(run.stdout)).toEqual({
			greeting: "hello from shop.api",
			duration: "1m",
			config: "greeting: hello from config",
		});
	});

	it("ships the declared dependencies, imported or not, at the installed version", () => {
		const manifest = JSON.parse(readFileSync(path.join(packaged, "package.json"), "utf8"));
		// is-number is declared in the workspace root and imported by nothing: it still ships.
		expect(manifest.dependencies).toEqual({ "is-number": "7.0.0", ms: "2.1.3" });
		expect(existsSync(path.join(packaged, "node_modules/is-number/package.json"))).toBe(true);
		// vitest is only a devDependency, and kernel/testing (which imports it) is never reached.
		expect(existsSync(path.join(packaged, "node_modules/vitest"))).toBe(false);
	});

	it("copies the library's es6 output with exports that point at it", () => {
		const library = JSON.parse(
			readFileSync(path.join(packaged, "node_modules/@fixture/kernel/package.json"), "utf8"),
		);
		expect(library.exports["./clock"]).toBe("./es6/src/clock.js");
		expect(
			existsSync(path.join(packaged, "node_modules/@fixture/kernel/es6/src/index.js")),
		).toBe(true);
	});

	it("copies the declared UI's build into .package/ui, files not links", () => {
		expect(readFileSync(path.join(packaged, "ui/index.html"), "utf8")).toContain("shop");
		expect(existsSync(path.join(packaged, "ui/assets/index-3f9a8c1b.js"))).toBe(true);
		expect(symlinksUnder(path.join(packaged, "ui"))).toEqual([]);
	});

	it("refuses to package a library", () => {
		const result = forge("package", "@fixture/kernel");
		expect(result.status).not.toBe(0);
		expect(`${result.stdout}${result.stderr}`).toContain("is a library, not a deployable");
	});
});
