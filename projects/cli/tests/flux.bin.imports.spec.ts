import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { importKindsOutput, importKindsWorkspace } from "./__fixtures__/import-kinds.js";

// Flux compiles without SWC's `jsc.paths` and `resolveFully`, so its resolve hook alone
// maps every kind of import to a source file. Real process: Node's hooks only run there.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const ws = realFs.mkdtempSync(join(tmpdir(), "decohere-flux-imports-"));

describe("flux run resolves every kind of import (real process)", () => {
	beforeAll(() => {
		for (const [relativePath, content] of Object.entries(importKindsWorkspace)) {
			realFs.mkdirSync(join(ws, relativePath, ".."), { recursive: true });
			realFs.writeFileSync(join(ws, relativePath), content);
		}
	});

	afterAll(() => {
		realFs.rmSync(ws, { recursive: true, force: true });
	});

	it("package names, package subpaths, extensionless and directory imports, tsconfig paths, dynamic import()", () => {
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				join(repo, "tools/register.mjs"),
				join(repo, "projects/cli/src/flux.ts"),
				"run",
				"projects/app/src/main.ts",
			],
			{ cwd: ws, encoding: "utf8", timeout: 30_000 },
		);

		expect(result.stderr).not.toMatch(/Error/);
		expect(result.status).toBe(0);
		const line = result.stdout.trim().split("\n").at(-1) ?? "";
		expect(JSON.parse(line)).toEqual(importKindsOutput);
	});
	// The child compiles flux itself from source: 3-5s under a full parallel run, past vitest's
	// 5s default. The other real-process suites allow 60s too.
}, 60_000);
