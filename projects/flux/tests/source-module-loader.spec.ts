import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createWorkspace, SwcTranspiler } from "@decohere/forge";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SourceModuleLoader } from "../src/source-module-loader.js";

// The loader discovers and reads real files from real disk.
vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("glob");

let root: string;
const files = ["projects/app/src/a.ts", "projects/app/src/b.ts", "projects/lib/src/index.ts"];

beforeAll(() => {
	root = mkdtempSync(path.join(tmpdir(), "flux-loader-"));
	const write = (relative: string, content: string) => {
		mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
		writeFileSync(path.join(root, relative), content);
	};
	write("package.json", JSON.stringify({ name: "loader-fixture", type: "module" }));
	for (const name of ["app", "lib"]) {
		write(
			`projects/${name}/package.json`,
			JSON.stringify({ name: `@t/${name}`, type: "module", main: "src/index.ts" }),
		);
	}
	for (const file of files) write(file, `export const value = ${JSON.stringify(file)};\n`);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** The load hook's compile step, called directly: vitest runs `import()` itself, not Node's hooks. */
type LoadStep = { loadTs(url: string): { source: string } | null };

describe("SourceModuleLoader", () => {
	// Rebuilding the SWC config (aliases, merges, a stat) for every file was about a
	// quarter of load time.
	it("builds each project's SWC config once, not once per file", async () => {
		const loader = new SourceModuleLoader();
		const transpiler = (
			loader as unknown as { transpiler: { createBaseConfig: () => unknown } }
		).transpiler;
		const createBaseConfig = vi.spyOn(transpiler, "createBaseConfig");
		await loader.configure({
			buildConfig: "debug",
			workspace: await createWorkspace({ rootDir: root }),
		});

		for (const file of files) {
			const loaded = (loader as unknown as LoadStep).loadTs(
				pathToFileURL(path.join(root, file)).href,
			);
			expect(loaded?.source).toContain(file);
		}

		expect(createBaseConfig).toHaveBeenCalledTimes(2);
		loader.dispose();
	});

	it("leaves import specifiers as written for the resolve hook", async () => {
		const loader = new SourceModuleLoader();
		const workspace = await createWorkspace({ rootDir: root });
		writeFileSync(
			path.join(root, "projects/app/src/a.ts"),
			`import { value } from "@t/lib";\nimport "./b";\nexport { value };\n`,
		);
		await loader.configure({ buildConfig: "debug", workspace });

		const loaded = (loader as unknown as LoadStep).loadTs(
			pathToFileURL(path.join(root, "projects/app/src/a.ts")).href,
		);

		expect(loaded?.source).toContain(`from "@t/lib"`);
		expect(loaded?.source).toContain(`import "./b"`);
		loader.dispose();
	});

	// Compiling ahead walks the entry's imports, so files it never imports stay uncompiled.
	it("compiles ahead what the entry imports, and nothing else", async () => {
		writeFileSync(
			path.join(root, "projects/app/src/a.ts"),
			`import { value } from "@t/lib";
export { value };
`,
		);
		writeFileSync(path.join(root, "projects/app/src/unused.ts"), "export const unused = 1;\n");
		const loader = new SourceModuleLoader();
		await loader.configure({
			buildConfig: "debug",
			workspace: await createWorkspace({ rootDir: root }),
		});
		const internals = loader as unknown as {
			compileAhead(entryPath: string): Promise<void>;
			transpileCache: Map<string, string>;
		};

		await internals.compileAhead(path.join(root, "projects/app/src/a.ts"));

		expect([...internals.transpileCache.keys()].sort()).toEqual([
			path.join(root, "projects/app/src/a.ts"),
			path.join(root, "projects/lib/src/index.ts"),
		]);
		loader.dispose();
	});
	// A new process with a cache from an earlier run compiles nothing that hasn't changed.
	it("serves files compiled by an earlier loader from the disk cache, without compiling", async () => {
		const cacheDir = mkdtempSync(path.join(tmpdir(), "flux-loader-cache-"));
		vi.stubEnv("DECOHERE_CACHE_DIR", cacheDir);
		try {
			writeFileSync(
				path.join(root, "projects/app/src/a.ts"),
				`import { value } from "@t/lib";\nexport const doubled: number = value.length * 2;\n`,
			);
			const entry = path.join(root, "projects/app/src/a.ts");
			const first = new SourceModuleLoader();
			await first.configure({
				buildConfig: "debug",
				workspace: await createWorkspace({ rootDir: root }),
			});
			await (first as unknown as { compileAhead(p: string): Promise<void> }).compileAhead(
				entry,
			);
			const compiled = (
				first as unknown as { transpileCache: Map<string, string> }
			).transpileCache.get(entry);
			first.dispose();

			const compile = vi.spyOn(SwcTranspiler.prototype, "transformCode");
			const compileSync = vi.spyOn(SwcTranspiler.prototype, "transformCodeSync");
			const second = new SourceModuleLoader();
			await second.configure({
				buildConfig: "debug",
				workspace: await createWorkspace({ rootDir: root }),
			});
			await (second as unknown as { compileAhead(p: string): Promise<void> }).compileAhead(
				entry,
			);
			const loaded = (second as unknown as LoadStep).loadTs(pathToFileURL(entry).href);

			expect(compile).not.toHaveBeenCalled();
			expect(compileSync).not.toHaveBeenCalled();
			expect(loaded?.source).toBe(compiled);
			second.dispose();
		} finally {
			vi.unstubAllEnvs();
			vi.restoreAllMocks();
			rmSync(cacheDir, { recursive: true, force: true });
		}
	});
});
