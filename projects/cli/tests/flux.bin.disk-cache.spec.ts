import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Flux caches compiled code on disk. Several processes starting at once with one empty
// cache must all run correctly and leave only whole entries behind.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const ws = realFs.mkdtempSync(join(tmpdir(), "decohere-flux-cache-"));
const cacheDir = join(ws, ".cache");
const MODELS = 30;

function write(relativePath: string, content: string) {
	const file = join(ws, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

function fluxRun(): Promise<{ code: number | null; output: string }> {
	return new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[
				"--import",
				join(repo, "tools/register.mjs"),
				join(repo, "projects/cli/src/flux.ts"),
				"run",
				"projects/app/src/main.ts",
			],
			{ cwd: ws, env: { ...process.env, DECOHERE_CACHE_DIR: cacheDir } },
		);
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.on("exit", (code) => resolve({ code, output }));
	});
}

function entries(): string[] {
	const fluxDir = join(cacheDir, "flux");
	if (!realFs.existsSync(fluxDir)) return [];
	return realFs
		.readdirSync(fluxDir, { recursive: true })
		.map(String)
		.filter((name) => !name.startsWith(".") && name.includes("/"));
}

describe("flux disk cache with concurrent processes (real process)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
		write(
			"projects/app/package.json",
			JSON.stringify({ name: "@ws/app", type: "module", main: "src/main.ts" }),
		);
		const imports: string[] = [];
		for (let i = 0; i < MODELS; i++) {
			write(`projects/app/src/model-${i}.ts`, `export const value${i}: number = ${i};\n`);
			imports.push(`import { value${i} } from "./model-${i}.js";`);
		}
		const sum = Array.from({ length: MODELS }, (_, i) => `value${i}`).join(" + ");
		write("projects/app/src/main.ts", `${imports.join("\n")}\nconsole.log("sum", ${sum});\n`);
	});

	afterAll(() => {
		realFs.rmSync(ws, { recursive: true, force: true });
	});

	it("runs four processes at once on one empty cache, then a fifth from the cache", async () => {
		const expected = `sum ${(MODELS * (MODELS - 1)) / 2}`;
		const runs = await Promise.all([fluxRun(), fluxRun(), fluxRun(), fluxRun()]);
		for (const run of runs) {
			expect(run.output).toContain(expected);
			expect(run.code, run.output).toBe(0);
		}

		const written = entries();
		// One entry per file, whole: no temp file left from a write that lost the race.
		expect(written.filter((name) => name.endsWith(".js"))).toHaveLength(MODELS + 1);
		expect(written.filter((name) => name.endsWith(".tmp"))).toEqual([]);

		const cached = await fluxRun();
		expect(cached.output).toContain(expected);
		expect(cached.code, cached.output).toBe(0);
		expect(entries()).toEqual(written);
	});
}, 120_000);
