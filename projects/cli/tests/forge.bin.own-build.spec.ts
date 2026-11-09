import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A project with a builder of its own (Astro, Vite) says so with a `build` script: forge build
// runs that script in the project's folder instead of compiling the project, and compiles the
// rest as before, in the same run. Real processes on a real folder, since a script can't run on
// memfs.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const ws = realFs.mkdtempSync(join(tmpdir(), "decohere-forge-own-build-"));
const site = join(ws, "projects/site/web");

function write(relativePath: string, content: string) {
	const file = join(ws, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

function sitePackage(scripts: Record<string, string>) {
	write("projects/site/web/package.json", JSON.stringify({ name: "@ws/site.web", scripts }));
}

function forgeBuild() {
	return spawnSync(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/cli/src/forge.ts"),
			"build",
			"--configuration",
			"release",
		],
		{ cwd: ws, encoding: "utf8", timeout: 60_000 },
	);
}

describe("forge build with a project that has its own build script (real processes)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
		write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
		write(
			"projects/lib/package.json",
			JSON.stringify({ name: "@ws/lib", type: "module", main: "src/index.ts" }),
		);
		write("projects/lib/src/index.ts", "export const answer: number = 42;\n");
		// The site's builder, installed once at the workspace root as Decohere installs everything.
		write(
			"node_modules/.bin/site-builder",
			`#!/usr/bin/env node
const fs = require("node:fs");
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/index.html", "<h1>" + process.cwd() + "</h1>");
`,
		);
		realFs.chmodSync(join(ws, "node_modules/.bin/site-builder"), 0o755);
		write("projects/site/web/src/page.ts", "export const title: string = 'Lions';\n");
		write("projects/site/web/astro.config.mjs", "export default {};\n");
	});

	afterAll(() => {
		realFs.rmSync(ws, { recursive: true, force: true });
	});

	it("runs the site's build script in its folder, and compiles the library", () => {
		sitePackage({ build: "site-builder" });

		const result = forgeBuild();
		const output = result.stdout + result.stderr;

		expect(result.status, output).toBe(0);
		expect(output).toContain(
			"Building @ws/site.web with its own build script (pnpm run build)",
		);
		expect(realFs.readFileSync(join(site, "dist/index.html"), "utf8")).toContain(site);
		// Forge wrote nothing for the site: no compiled code, no copied config.
		expect(realFs.existsSync(join(ws, "dist/release/projects/site"))).toBe(false);
		expect(
			realFs.existsSync(join(ws, "dist/release/projects/lib/es6/src/index.js")) ||
				realFs.existsSync(join(ws, "dist/release/projects/lib/src/index.js")),
		).toBe(true);
	});

	it("fails when the site's build script fails", () => {
		sitePackage({ build: 'node -e "process.exit(3)"' });

		const result = forgeBuild();

		expect(result.status).not.toBe(0);
		expect(result.stdout + result.stderr).toContain(
			"@ws/site.web's build script failed (pnpm run build exited with 3)",
		);
	});

	it("compiles a project whose build script calls forge, rather than calling forge again", () => {
		sitePackage({ build: "forge build" });

		const result = forgeBuild();
		const output = result.stdout + result.stderr;

		expect(result.status, output).toBe(0);
		expect(output).not.toContain("with its own build script");
		expect(realFs.existsSync(join(ws, "dist/release/projects/site"))).toBe(true);
	});
}, 180_000);
