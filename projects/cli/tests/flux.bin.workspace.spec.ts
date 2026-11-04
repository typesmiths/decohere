import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Flux compiles the files the workspace package discovers. A path with a space never matched the workspace's
// list, and a run from a package directory (given --root-dir) discovered from the wrong root, so those files
// fell through to Node's type stripping, which can't handle decorators.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const parent = realFs.mkdtempSync(join(tmpdir(), "decohere-flux-ws-"));
const ws = join(parent, "my workspace");

const DECORATED = (name: string) => `function tag(_target: unknown) {}
@tag
export class ${name} {
	public greet(who: string) {
		return \`hello \${who}\`;
	}
}
`;

function write(relativePath: string, content: string) {
	const file = join(ws, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

function fluxRun(cwd: string, file: string, ...flags: string[]) {
	return spawnSync(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/cli/src/flux.ts"),
			"run",
			...flags,
			file,
		],
		{ cwd, encoding: "utf8", timeout: 30_000 },
	);
}

describe("flux run compiles the files the workspace package discovers (real process)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
		write(
			"tsconfig.json",
			JSON.stringify({
				compilerOptions: {
					target: "es2022",
					module: "nodenext",
					experimentalDecorators: true,
					emitDecoratorMetadata: true,
				},
			}),
		);
		write(
			"projects/lib/package.json",
			JSON.stringify({ name: "@ws/lib", type: "module", main: "src/index.ts" }),
		);
		write("projects/lib/src/index.ts", DECORATED("Greeter"));
		write(
			"projects/app/package.json",
			JSON.stringify({ name: "@ws/app", type: "module", main: "src/main.ts" }),
		);
		write(
			"projects/app/src/main.ts",
			`import { Greeter } from "@ws/lib";\n${DECORATED("Local")}console.log(new Greeter().greet("app"), new Local().greet("local"));\n`,
		);
	});

	afterAll(() => {
		realFs.rmSync(parent, { recursive: true, force: true });
	});

	it("a project file whose path contains a space", () => {
		const result = fluxRun(ws, "projects/app/src/main.ts");
		expect(result.stderr).not.toContain("Invalid or unexpected token");
		expect(result.stdout).toContain("hello app hello local");
		expect(result.status).toBe(0);
	});

	it("run from inside a package directory, with --root-dir naming the workspace", () => {
		const result = fluxRun(join(ws, "projects/app"), "src/main.ts", "--root-dir", "../..");
		expect(result.stderr).not.toContain("Invalid or unexpected token");
		expect(result.stdout).toContain("hello app hello local");
		expect(result.status).toBe(0);
	});

	// The CLI built its workspace from workspace defaults (debug only), unlike flux.run.
	it("accepts --configuration release, like the programmatic API", () => {
		const result = fluxRun(ws, "projects/app/src/main.ts", "--configuration", "release");
		expect(result.stdout).toContain("hello app hello local");
		expect(result.status).toBe(0);
	});
}, 120_000);
