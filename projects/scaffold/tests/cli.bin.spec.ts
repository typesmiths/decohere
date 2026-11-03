import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

// The bin entry exits with the code `runCli` returns. The integration suite calls
// `runCli` in process, so this runs the real bin to cover the exit itself.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const dir = realFs.mkdtempSync(join(tmpdir(), "decohere-scaffold-bin-"));

function decohere(...args: string[]) {
	return spawnSync(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/scaffold/src/cli.ts"),
			...args,
		],
		{ cwd: dir, encoding: "utf8", timeout: 30_000 },
	);
}

describe("decohere bin (real process)", () => {
	afterAll(() => {
		realFs.rmSync(dir, { recursive: true, force: true });
	});

	it("exits 0 after printing help", () => {
		const result = decohere("--help");
		expect(result.stdout).toContain("Usage: decohere");
		expect(result.status, result.stderr).toBe(0);
	});

	it("exits 1 when the command fails", () => {
		const result = decohere("add", "api", "billing", "-d", dir);
		expect(result.stderr).toContain("Not a Decohere workspace");
		expect(result.status).toBe(1);
	});
}, 60_000);
