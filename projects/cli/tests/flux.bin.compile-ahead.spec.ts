import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Flux compiles the entry and what it imports before Node loads them, in parallel. A
// workspace file the app never imports must not stop it starting, and one it does import must
// still fail the way it did when the load hook compiled it.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const ws = realFs.mkdtempSync(join(tmpdir(), "decohere-flux-ahead-"));

// Not valid TypeScript, so SWC rejects it.
const BROKEN = "export const value = ;\n";

function write(relativePath: string, content: string) {
	const file = join(ws, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

function fluxRun(file: string) {
	return spawnSync(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/cli/src/flux.ts"),
			"run",
			file,
		],
		{ cwd: ws, encoding: "utf8", timeout: 30_000 },
	);
}

describe("flux run compiles ahead of Node (real process)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
		write(
			"tsconfig.json",
			JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
		);
		write(
			"projects/lib/package.json",
			JSON.stringify({ name: "@ws/lib", type: "module", main: "src/index.ts" }),
		);
		// Reached through a package alias, then a directory import, then a relative `.js` import.
		write("projects/lib/src/index.ts", `export * from "./models";\n`);
		write("projects/lib/src/models/index.ts", `export * from "./greeter.js";\n`);
		write(
			"projects/lib/src/models/greeter.ts",
			`function tag(_target: unknown) {}
@tag
export class Greeter {
	public greet(who: string): string {
		return \`hello \${who}\`;
	}
}
`,
		);
		write("projects/lib/src/unused-broken.ts", BROKEN);
		write("projects/lib/src/imported-broken.ts", BROKEN);
		write(
			"projects/app/package.json",
			JSON.stringify({ name: "@ws/app", type: "module", main: "src/main.ts" }),
		);
		write(
			"projects/app/src/main.ts",
			`import { Greeter } from "@ws/lib";\nconsole.log(new Greeter().greet("app"));\n`,
		);
		write(
			"projects/app/src/uses-broken.ts",
			`import { value } from "../../lib/src/imported-broken.js";\nconsole.log(value);\n`,
		);
	});

	afterAll(() => {
		realFs.rmSync(ws, { recursive: true, force: true });
	});

	it("runs the app when a workspace file it never imports does not compile", () => {
		const result = fluxRun("projects/app/src/main.ts");
		expect(result.stdout, result.stderr).toContain("hello app");
		expect(result.status, result.stderr).toBe(0);
	});

	it("fails naming the file when a file the app imports does not compile", () => {
		const result = fluxRun("projects/app/src/uses-broken.ts");
		expect(result.status).toBe(1);
		expect(result.stdout + result.stderr).toContain(
			`Failed to transpile ${join(ws, "projects/lib/src/imported-broken.ts")}`,
		);
	});
}, 120_000);
