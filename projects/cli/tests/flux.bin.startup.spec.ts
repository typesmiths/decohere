import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

// `flux run` starts in about the time `node` takes plus SWC. The TypeScript compiler alone
// took longer to load than the rest of a run, and rxjs was a third of the modules loaded;
// neither is needed to run a file. This keeps them off that path.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const dir = realFs.mkdtempSync(join(tmpdir(), "decohere-flux-startup-"));
const loaded = join(dir, "loaded.txt");

realFs.writeFileSync(
	join(dir, "package.json"),
	JSON.stringify({ name: "solo", version: "1.0.0", type: "module" }),
);
realFs.writeFileSync(
	join(dir, "tsconfig.json"),
	JSON.stringify({ compilerOptions: { target: "es2022", baseUrl: "." } }),
);
realFs.writeFileSync(join(dir, "hello.ts"), `console.log("Hello");\n`);
realFs.writeFileSync(
	join(dir, "record-loads.mjs"),
	`import { registerHooks } from "node:module";
import { appendFileSync } from "node:fs";
registerHooks({
	load(url, context, next) {
		appendFileSync(${JSON.stringify(loaded)}, url + "\\n");
		return next(url, context);
	},
});
`,
);

afterAll(() => {
	realFs.rmSync(dir, { recursive: true, force: true });
});

describe("flux run start-up (real process)", () => {
	it("runs a file without loading the TypeScript compiler or rxjs", () => {
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				join(repo, "tools/register.mjs"),
				"--import",
				join(dir, "record-loads.mjs"),
				join(repo, "projects/cli/src/flux.ts"),
				"run",
				"hello.ts",
			],
			{ cwd: dir, encoding: "utf8", timeout: 60_000 },
		);

		expect(result.status, result.stderr).toBe(0);
		// The script's own output, exactly as it wrote it.
		expect(result.stdout).toBe("Hello\n");
		const urls = realFs.readFileSync(loaded, "utf8").split("\n");
		expect(urls.filter((url) => /\/node_modules\/(typescript|rxjs)\//.test(url))).toEqual([]);
	});
});
