import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Where someone tries flux first: a plain folder. With a package.json it's a standalone project,
// whose root package is the one package; with none, the file belongs to no package and flux
// compiles it anyway. Either way it used to fall through to Node's type stripping, which
// rejects enums, decorators and parameter properties.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const dir = realFs.mkdtempSync(join(tmpdir(), "decohere-flux-plain-"));

function write(relativePath: string, content: string) {
	const file = join(dir, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

function fluxRun(...args: string[]) {
	return spawnSync(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/cli/src/flux.ts"),
			"run",
			...args,
		],
		{ cwd: dir, encoding: "utf8", timeout: 30_000 },
	);
}

describe("flux run in a folder with no workspace packages (real process)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify({ name: "plain", private: true, type: "module" }));
		write(
			"greeting.ts",
			`export enum Level {\n\tInfo = "info",\n}\n\nexport function logged(_target: object, key: string, descriptor: PropertyDescriptor) {\n\tconst run = descriptor.value;\n\tdescriptor.value = function (...args: unknown[]) {\n\t\tconsole.log(\`-> \${key}(\${args.join(", ")})\`);\n\t\treturn run.apply(this, args);\n\t};\n}\n`,
		);
		write(
			"app.ts",
			`import { Level, logged } from "./greeting.js";\n\nclass Greeter {\n\tconstructor(private readonly level: Level) {}\n\n\t@logged\n\tgreet(name: string) {\n\t\treturn \`[\${this.level}] Hello, \${name}!\`;\n\t}\n}\n\nconsole.log(new Greeter(Level.Info).greet(process.argv[2] ?? "world"));\n`,
		);
	});

	afterAll(() => {
		realFs.rmSync(dir, { recursive: true, force: true });
	});

	it("compiles enums, decorators and parameter properties, and finds ./greeting.js as greeting.ts", () => {
		const result = fluxRun("app.ts", "Ada");

		expect(result.stdout, result.stderr).toContain("-> greet(Ada)");
		expect(result.stdout, result.stderr).toContain("[info] Hello, Ada!");
		expect(result.status, result.stderr).toBe(0);
	});

	it("compiles a file in a folder with no package.json, which belongs to no package", () => {
		realFs.rmSync(join(dir, "package.json"));
		try {
			const result = fluxRun("app.ts", "Bo");

			expect(result.stdout, result.stderr).toContain("[info] Hello, Bo!");
			expect(result.status, result.stderr).toBe(0);
		} finally {
			write("package.json", JSON.stringify({ name: "plain", private: true, type: "module" }));
		}
	});
}, 60_000);
