import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	collectWorkspacePackages,
	fileSpec,
	rewriteDecohereDepsToFile,
} from "../pack-builder-tgz.mjs";

const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
const PACKER = fileURLToPath(new URL("../pack-builder-tgz.mjs", import.meta.url));

beforeEach(() => {
	vol.reset();
});

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("pack-builder-tgz", () => {
	it("indexes @decohere packages and skips node_modules", () => {
		vol.fromJSON({
			"/dist/release/projects/create/package.json": JSON.stringify({
				name: "@decohere/create",
			}),
			"/dist/release/projects/core/package.json": JSON.stringify({ name: "@decohere/core" }),
			"/dist/release/projects/scribe/scribe/package.json": JSON.stringify({
				name: "@decohere/scribe",
			}),
			"/dist/release/projects/scaffold/package.json": JSON.stringify({
				name: "@decohere/scaffold",
			}),
			"/dist/release/projects/create/node_modules/foo/package.json": JSON.stringify({
				name: "foo",
			}),
			"/dist/release/projects/other/package.json": JSON.stringify({ name: "not-scoped" }),
		});

		expect(
			collectWorkspacePackages("/dist/release")
				.map((pkg) => pkg.name)
				.sort(),
		).toEqual([
			"@decohere/core",
			"@decohere/create",
			"@decohere/scaffold",
			"@decohere/scribe",
		]);
	});

	it("rewrites direct @decohere deps to file: and leaves public deps unchanged", () => {
		const packages = [
			{ name: "@decohere/create", dir: "/dist/release/projects/create" },
			{ name: "@decohere/core", dir: "/dist/release/projects/core" },
			{ name: "@decohere/scribe", dir: "/dist/release/projects/scribe/scribe" },
		];
		const pkg = {
			name: "@decohere/create",
			dependencies: {
				"@decohere/core": "0.0.1-dev.46",
				commander: "^13.1.0",
			},
		};

		expect(fileSpec("/dist/release/projects/create", "/dist/release/projects/core")).toBe(
			"file:../core",
		);
		expect(rewriteDecohereDepsToFile(pkg, "/dist/release/projects/create", packages)).toEqual({
			name: "@decohere/create",
			dependencies: {
				"@decohere/core": "file:../core",
				commander: "^13.1.0",
			},
			optionalDependencies: undefined,
		});
		expect(pkg.dependencies).toEqual({
			"@decohere/core": "0.0.1-dev.46",
			commander: "^13.1.0",
		});
	});

	it("rewrites nested workspace deps so sibling installs do not hit the registry", () => {
		const packages = [
			{ name: "@decohere/core", dir: "/dist/release/projects/core" },
			{ name: "@decohere/scribe", dir: "/dist/release/projects/scribe/scribe" },
		];
		const core = {
			name: "@decohere/core",
			dependencies: { "@decohere/scribe": "0.0.1-dev.46" },
		};

		expect(rewriteDecohereDepsToFile(core, "/dist/release/projects/core", packages)).toEqual({
			name: "@decohere/core",
			dependencies: { "@decohere/scribe": "file:../scribe/scribe" },
			optionalDependencies: undefined,
		});
	});

	it("vendors nested @decohere deps from the installed tree (no EOVERRIDE)", () => {
		const root = fs.mkdtempSync(join(tmpdir(), "pack-builder-"));
		tempDirs.push(root);
		const createDir = join(root, "projects/create");
		const coreDir = join(root, "projects/core");
		const scribeDir = join(root, "projects/scribe");
		const version = "0.0.0-test-not-published";
		fs.mkdirSync(join(createDir, "es6/src"), { recursive: true });
		fs.mkdirSync(coreDir, { recursive: true });
		fs.mkdirSync(scribeDir, { recursive: true });
		fs.writeFileSync(join(scribeDir, "index.js"), "export const ok = true;\n");
		fs.writeFileSync(
			join(coreDir, "index.js"),
			`import "@decohere/scribe";\nexport const ok = true;\n`,
		);
		fs.writeFileSync(
			join(coreDir, "package.json"),
			`${JSON.stringify(
				{
					name: "@decohere/core",
					version,
					type: "module",
					exports: "./index.js",
					dependencies: { "@decohere/scribe": version },
				},
				null,
				2,
			)}\n`,
		);
		fs.writeFileSync(
			join(scribeDir, "package.json"),
			`${JSON.stringify(
				{
					name: "@decohere/scribe",
					version,
					type: "module",
					exports: "./index.js",
				},
				null,
				2,
			)}\n`,
		);
		fs.writeFileSync(
			join(createDir, "package.json"),
			`${JSON.stringify(
				{
					name: "@decohere/create",
					version,
					dependencies: { "@decohere/core": version },
				},
				null,
				2,
			)}\n`,
		);
		fs.writeFileSync(
			join(createDir, "es6/src/cli.js"),
			`import "@decohere/core";\nconsole.log("ok");\n`,
		);
		const dest = join(root, "create.tgz");

		const result = spawnSync(
			process.execPath,
			[
				PACKER,
				"--out-dir",
				createDir,
				"--workspace-out",
				join(root, "projects"),
				"--dest",
				dest,
			],
			{ encoding: "utf8" },
		);

		expect(result.status, result.stderr + result.stdout).toBe(0);
		expect(fs.existsSync(dest)).toBe(true);
		expect(result.stderr + result.stdout).not.toContain("EOVERRIDE");
		const unpacked = join(root, "unpacked");
		fs.mkdirSync(unpacked);
		const extracted = spawnSync("tar", ["-xzf", dest, "-C", unpacked], { encoding: "utf8" });
		expect(extracted.status, extracted.stderr).toBe(0);
		const booted = spawnSync(process.execPath, [join(unpacked, "es6/src/cli.js")], {
			encoding: "utf8",
			cwd: unpacked,
		});
		expect(booted.status, booted.stderr + booted.stdout).toBe(0);
		expect(booted.stdout).toContain("ok");
		expect(JSON.parse(fs.readFileSync(join(createDir, "package.json"), "utf8"))).toEqual({
			name: "@decohere/create",
			version,
			dependencies: { "@decohere/core": version },
		});
		expect(
			JSON.parse(fs.readFileSync(join(coreDir, "package.json"), "utf8")).dependencies,
		).toEqual({
			"@decohere/scribe": version,
		});
	});
});
