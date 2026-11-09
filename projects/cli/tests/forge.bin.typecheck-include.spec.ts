import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A project with a tsconfig of its own is checked on the files that tsconfig lists, as `tsc -p`
// checks it: a generated declaration file it includes (a framework's or a codegen tool's) declares
// modules its code imports. A project on the workspace's tsconfig is checked on its own sources.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const ws = realFs.mkdtempSync(join(tmpdir(), "decohere-forge-typecheck-include-"));

function write(relativePath: string, content: string) {
	const file = join(ws, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

function typecheck() {
	return spawnSync(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/cli/src/forge.ts"),
			"typecheck",
		],
		{ cwd: ws, encoding: "utf8", timeout: 60_000 },
	);
}

describe("forge typecheck reads a project's own tsconfig include (real process)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
		// The workspace's tsconfig includes everything; a project on it is still checked alone.
		write(
			"tsconfig.json",
			JSON.stringify({
				compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext" },
				include: ["**/*"],
			}),
		);
		write("scratch/broken.ts", 'export const broken: number = "not a project file";\n');
		write(
			"projects/lib/package.json",
			JSON.stringify({ name: "@ws/lib", type: "module", main: "src/index.ts" }),
		);
		write("projects/lib/src/index.ts", "export const answer: number = 42;\n");
		write("projects/web/package.json", JSON.stringify({ name: "@ws/web", type: "module" }));
		write(
			"projects/web/tsconfig.json",
			JSON.stringify({
				compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
				include: ["src", "generated/types.d.ts"],
			}),
		);
		write(
			"projects/web/generated/types.d.ts",
			'declare module "virtual:config" {\n\texport const title: string;\n}\n',
		);
	});

	afterAll(() => {
		realFs.rmSync(ws, { recursive: true, force: true });
	});

	it("passes when the project's tsconfig includes the file that declares a module it imports", () => {
		write(
			"projects/web/src/index.ts",
			'import { title } from "virtual:config";\nexport const heading: string = title;\n',
		);

		const result = typecheck();
		const output = result.stdout + result.stderr;

		expect(result.status, output).toBe(0);
		expect(output).not.toContain("TS2307");
		// The workspace tsconfig's `include` didn't pull in a file outside every project.
		expect(output).not.toContain("broken.ts");
	});

	it("still fails on a real type error in that project", () => {
		write(
			"projects/web/src/index.ts",
			'import { title } from "virtual:config";\nexport const heading: number = title;\n',
		);

		const result = typecheck();

		expect(result.status).not.toBe(0);
		expect(result.stdout + result.stderr).toContain("TS2322");
	});
}, 180_000);
