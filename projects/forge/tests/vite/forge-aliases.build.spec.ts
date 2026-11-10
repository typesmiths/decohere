import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A site that Vite builds (as Astro does) imports a sibling workspace package by name, with no pnpm
// workspace, no link: dependency and no alias of its own: Vite resolves it through forgeAliases(),
// and tsc through the tsconfig.paths.json that `forge paths` writes. Real processes on a real folder.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const vite = pathToFileURL(join(repo, "node_modules/vite/dist/node/index.js")).href;
const plugin = pathToFileURL(join(repo, "projects/forge/src/vite/index.ts")).href;
const ws = realFs.mkdtempSync(join(tmpdir(), "decohere-vite-aliases-"));
const site = join(ws, "projects/clubs/lions/web");

function write(relativePath: string, content: string) {
	const file = join(ws, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

/** Vite's build, run from the site's folder as `astro build` is. */
function viteBuild(plugins: "forgeAliases()" | "none") {
	write(
		"tools/build.mjs",
		`import { build } from ${JSON.stringify(vite)};
import { forgeAliases } from ${JSON.stringify(plugin)};
await build({
	logLevel: "silent",
	plugins: ${plugins === "none" ? "[]" : "[forgeAliases()]"},
	build: { outDir: "dist", emptyOutDir: true, lib: { entry: "src/main.ts", formats: ["es"], fileName: "main" } },
});
`,
	);
	return run(site, [join(ws, "tools/build.mjs")]);
}

function run(cwd: string, args: string[]) {
	return spawnSync(process.execPath, ["--import", join(repo, "tools/register.mjs"), ...args], {
		cwd,
		encoding: "utf8",
		timeout: 60_000,
	});
}

describe("a Vite-built site imports a workspace package by name (real processes)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
		write(
			"projects/ui/package.json",
			JSON.stringify({ name: "@ws/ui", type: "module", exports: { "./*": "./src/*" } }),
		);
		write(
			"projects/ui/src/format.ts",
			"export const format = (name: string) => `Go ${name}!`;\n",
		);
		write("projects/ui/src/theme.css", ".badge { color: rebeccapurple; }\n");
		write(
			"projects/clubs/lions/web/package.json",
			JSON.stringify({ name: "@ws/lions.web", type: "module" }),
		);
		write(
			"projects/clubs/lions/web/src/main.ts",
			`import { format } from "@ws/ui/format";
import theme from "@ws/ui/theme.css?inline";

export const banner = format("Lions");
export const styles = theme;
`,
		);
		write(
			"projects/clubs/lions/web/src/env.d.ts",
			'declare module "*?inline" {\n\tconst css: string;\n\texport default css;\n}\n',
		);
		// What a site's tsconfig adds: extend the generated paths, beside Astro's own base.
		write(
			"projects/clubs/lions/web/tsconfig.json",
			JSON.stringify({
				extends: "../../../../tsconfig.paths.json",
				compilerOptions: {
					strict: true,
					target: "es2022",
					module: "preserve",
					moduleResolution: "bundler",
					noEmit: true,
				},
				include: ["src"],
			}),
		);
		// The workspace's paths, as `forge paths` writes them (Vite reads the site's tsconfig too).
		const paths = run(ws, [join(repo, "projects/cli/src/forge.ts"), "paths"]);
		if (paths.status !== 0)
			throw new Error(`forge paths failed: ${paths.stderr}${paths.stdout}`);
	});

	afterAll(() => {
		realFs.rmSync(ws, { recursive: true, force: true });
	});

	it("fails to build without the plugin: nothing else resolves the package", () => {
		const result = viteBuild("none");
		expect(result.status).not.toBe(0);
		expect(result.stderr + result.stdout).toMatch(/@ws\/ui/);
	});

	it("builds with forgeAliases(), the package's TypeScript and CSS in the bundle", () => {
		const result = viteBuild("forgeAliases()");
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		const bundle = realFs.readFileSync(join(site, "dist/main.js"), "utf8");
		expect(bundle).toContain("Go ");
		expect(bundle).toContain(".badge");
	});

	it("type-checks with tsc through the paths `forge paths` writes", () => {
		const tsc = spawnSync(
			process.execPath,
			[join(repo, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
			{ cwd: site, encoding: "utf8", timeout: 60_000 },
		);
		expect(tsc.stdout).toBe("");
		expect(tsc.status).toBe(0);
	});
}, 120_000);
