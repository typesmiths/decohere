import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A project with one package.json and no projects/ folder: the root package.json is the one
// package. Forge used to see no packages there; dependency sync, which writes a package's
// manifest from the root's, would empty the devDependencies when both are the same file.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const dir = realFs.mkdtempSync(join(tmpdir(), "decohere-forge-standalone-"));
const manifest = {
	name: "solo",
	version: "1.0.0",
	type: "module",
	exports: { ".": "./es6/src/main.js" },
	devDependencies: { typescript: "^5.9.0", vitest: "^4.0.0" },
};

function write(relativePath: string, content: string) {
	const file = join(dir, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

function forge(...args: string[]) {
	return forgeIn(dir, ...args);
}

function forgeIn(cwd: string, ...args: string[]) {
	return spawnSync(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/cli/src/forge.ts"),
			...args,
		],
		{ cwd, encoding: "utf8", timeout: 60_000 },
	);
}

function readManifest() {
	return JSON.parse(realFs.readFileSync(join(dir, "package.json"), "utf8")) as typeof manifest;
}

describe("forge in a standalone project (real process)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify(manifest, null, 2));
		write(
			"src/main.ts",
			`enum Level {\n\tInfo = "info",\n}\nexport const level = Level.Info;\n`,
		);
	});

	afterAll(() => {
		realFs.rmSync(dir, { recursive: true, force: true });
	});

	it("builds the root package into dist/<configuration>/", () => {
		const result = forge("build");

		expect(result.status, result.stderr).toBe(0);
		expect(realFs.existsSync(join(dir, "dist/debug/src/main.js")), result.stdout).toBe(true);
	});

	it("builds from a subfolder when --root-dir names the project's folder", () => {
		realFs.rmSync(join(dir, "dist"), { recursive: true, force: true });

		const result = forgeIn(join(dir, "src"), "build", "--root-dir", "..");

		expect(result.status, result.stderr).toBe(0);
		expect(realFs.existsSync(join(dir, "dist/debug/src/main.js")), result.stdout).toBe(true);
		expect(realFs.existsSync(join(dir, "src/dist"))).toBe(false);
	});

	it("leaves the root package.json alone on dependency sync: it is the package's own", () => {
		const result = forge("dependencies", "sync");

		expect(result.status, result.stderr).toBe(0);
		expect(readManifest().devDependencies).toEqual(manifest.devDependencies);
	});

	it("writes no tsconfig.paths.json: one package has no other to import from source", () => {
		const result = forge("paths");

		expect(result.status, result.stderr).toBe(0);
		expect(realFs.existsSync(join(dir, "tsconfig.paths.json"))).toBe(false);
	});

	it("bumps the one package.json once", () => {
		const result = forge("version", "--release-type", "patch");

		expect(result.status, result.stderr).toBe(0);
		expect(readManifest().version).toBe("1.0.1");
		expect(readManifest().devDependencies).toEqual(manifest.devDependencies);
	});
}, 180_000);
