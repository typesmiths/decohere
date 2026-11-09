import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A site's code is checked by its framework's own checker (`astro check`, `svelte-check`): only
// that reads its component files and its virtual modules (`astro:content`). forge typecheck runs a
// project's own `check` script instead of checking it with tsc, and checks the rest as before.
// Real processes on a real folder, since a script can't run on memfs.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const ws = realFs.mkdtempSync(join(tmpdir(), "decohere-forge-own-check-"));
const site = join(ws, "projects/site/web");

function write(relativePath: string, content: string) {
	const file = join(ws, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

function sitePackage(scripts: Record<string, string>) {
	write("projects/site/web/package.json", JSON.stringify({ name: "@ws/site.web", scripts }));
}

function typecheck() {
	return spawnSync(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/cli/src/forge.ts"),
			"typecheck",
		],
		{ cwd: ws, encoding: "utf8", timeout: 60_000 },
	);
}

describe("forge typecheck with a project that has its own check script (real processes)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
		write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
		write(
			"projects/lib/package.json",
			JSON.stringify({ name: "@ws/lib", type: "module", main: "src/index.ts" }),
		);
		write("projects/lib/src/index.ts", "export const answer: number = 42;\n");
		// The site's checker, installed once at the workspace root as Decohere installs everything.
		write(
			"node_modules/.bin/site-checker",
			`#!/usr/bin/env node
require("node:fs").writeFileSync("checked", process.cwd());
`,
		);
		realFs.chmodSync(join(ws, "node_modules/.bin/site-checker"), 0o755);
		// Only the framework's checker knows this module: tsc would fail on it.
		write(
			"projects/site/web/src/posts.ts",
			'import { getCollection } from "astro:content";\nexport const posts = getCollection("posts");\n',
		);
		// A shared UI library with browser code, its own tsconfig and no checker of its own.
		write(
			"projects/ui/package.json",
			JSON.stringify({ name: "@ws/ui", type: "module", main: "src/index.ts" }),
		);
		write(
			"projects/ui/tsconfig.json",
			JSON.stringify({
				compilerOptions: {
					target: "ES2022",
					module: "ESNext",
					moduleResolution: "Bundler",
					strict: true,
				},
			}),
		);
		write(
			"projects/ui/src/index.ts",
			"export const setTitle = (title: string): void => {\n\tdocument.title = title;\n};\n",
		);
	});

	afterAll(() => {
		realFs.rmSync(ws, { recursive: true, force: true });
	});

	it("runs the site's check script in its folder, and checks the rest with tsc", () => {
		sitePackage({ check: "site-checker" });

		const result = typecheck();
		const output = result.stdout + result.stderr;

		expect(result.status, output).toBe(0);
		expect(output).toContain(
			"Type-checking @ws/site.web with its own check script (pnpm run check)",
		);
		expect(realFs.readFileSync(join(site, "checked"), "utf8")).toBe(site);
		expect(output).not.toContain("astro:content");
	});

	it("fails when the site's check script fails", () => {
		sitePackage({ check: 'node -e "process.exit(2)"' });

		const result = typecheck();

		expect(result.status).not.toBe(0);
		expect(result.stdout + result.stderr).toContain(
			"@ws/site.web's check script failed (pnpm run check exited with 2)",
		);
	});

	it("still fails on a real type error in a project forge checks", () => {
		sitePackage({ check: "site-checker" });
		write("projects/lib/src/index.ts", 'export const answer: number = "nope";\n');

		const result = typecheck();

		write("projects/lib/src/index.ts", "export const answer: number = 42;\n");
		expect(result.status).not.toBe(0);
		expect(result.stdout + result.stderr).toContain("TS2322");
	});
}, 180_000);
