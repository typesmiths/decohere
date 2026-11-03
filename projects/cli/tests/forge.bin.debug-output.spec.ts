import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { importKindsOutput, importKindsWorkspace } from "./__fixtures__/import-kinds.js";

// A debug build must run with plain `node`: SWC rewrites aliases (`jsc.paths`) and completes
// relative paths (`resolveFully`) in the emitted JavaScript. Flux no longer needs either,
// so this guards forge's half of the shared SWC defaults. Real process, real disk.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const ws = realFs.mkdtempSync(join(tmpdir(), "decohere-forge-debug-"));
const mainJs = join(ws, "dist/debug/projects/app/src/main.js");

describe("forge build debug output runs with plain node (real process)", () => {
	beforeAll(() => {
		for (const [relativePath, content] of Object.entries(importKindsWorkspace)) {
			realFs.mkdirSync(join(ws, relativePath, ".."), { recursive: true });
			realFs.writeFileSync(join(ws, relativePath), content);
		}
		const build = spawnSync(
			process.execPath,
			[
				"--import",
				join(repo, "tools/register.mjs"),
				join(repo, "projects/cli/src/forge.ts"),
				"build",
			],
			{ cwd: ws, encoding: "utf8", timeout: 60_000 },
		);
		if (build.status !== 0) {
			throw new Error(`forge build failed:\n${build.stdout}\n${build.stderr}`);
		}
	}, 60_000);

	afterAll(() => {
		realFs.rmSync(ws, { recursive: true, force: true });
	});

	it("rewrites every import to a relative .js path", () => {
		const code = realFs.readFileSync(mainJs, "utf8");

		expect(code).toContain(`from "../../lib/src/index.js"`); // @ws/lib
		expect(code).toContain(`from "../../lib/src/models/index.js"`); // @ws/lib/models
		expect(code).toContain(`from "./util.js"`); // ./util
		expect(code).toContain(`from "./parts/index.js"`); // ./parts
		expect(code).toContain(`from "./shared/greeting.js"`); // @app/shared/greeting
		expect(code).toContain(`import("../../lib/src/models/index.js")`); // dynamic import()
	});

	it("runs with plain node, no flux and no hooks", () => {
		const result = spawnSync(process.execPath, [mainJs], {
			cwd: ws,
			encoding: "utf8",
			timeout: 15_000,
		});

		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout.trim())).toEqual(importKindsOutput);
	});
});
