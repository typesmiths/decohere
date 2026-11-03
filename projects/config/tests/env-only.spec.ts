import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// dotenv reads the real disk (it is not routed through the memfs mock), so use a real temp dir.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");

describe("config reads configuration from the environment only", () => {
	const sentinel = "DECOHERE_ENV_ONLY_SENTINEL";
	const originalCwd = process.cwd();
	let dir: string | undefined;

	afterEach(() => {
		process.chdir(originalCwd);
		delete process.env[sentinel];
		if (dir) realFs.rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	it("does not load a .env file from the working directory on import", async () => {
		dir = realFs.mkdtempSync(join(tmpdir(), "decohere-env-only-"));
		realFs.writeFileSync(join(dir, ".env"), `${sentinel}=from-dotenv\n`);
		process.chdir(dir);

		vi.resetModules();
		await import("../src/yaml-data-source.js");

		expect(process.env[sentinel]).toBeUndefined();
	});
});
