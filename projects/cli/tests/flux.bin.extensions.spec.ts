import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Flux compiled only `.ts`. An `.mts`, `.cts` or `.tsx` file fell through to Node's type
// stripping, which can't handle JSX, decorators or a CommonJS `.cts` written with `export`.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const ws = realFs.mkdtempSync(join(tmpdir(), "decohere-flux-ext-"));

function write(relativePath: string, content: string) {
	const file = join(ws, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

describe("flux run compiles .mts, .cts and .tsx (real process)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
		write(
			"tsconfig.json",
			JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
		);
		write(
			"projects/app/package.json",
			JSON.stringify({ name: "@ws/app", type: "module", main: "src/main.ts" }),
		);
		write(
			"projects/app/src/util.mts",
			`function tag(_target: unknown) {}\n@tag\nexport class Greeter {\n\tpublic greet(who: string): string {\n\t\treturn \`hello \${who}\`;\n\t}\n}\n`,
		);
		write(
			"projects/app/src/legacy.cts",
			`const version: number = 3;\nexport const legacy = { version };\n`,
		);
		write(
			"projects/app/src/view.tsx",
			`const React = { createElement: (tag: string, _props: unknown, ...children: string[]) => \`<\${tag}>\${children.join("")}</\${tag}>\` };\nexport const view = (name: string) => <b>{name}</b>;\n`,
		);
		write(
			"projects/app/src/main.ts",
			`import { Greeter } from "./util.mjs";\nimport legacyModule from "./legacy.cjs";\nimport { view } from "./view.js";\nconsole.log(new Greeter().greet("mts"), legacyModule.legacy.version, view("tsx"));\n`,
		);
	});

	afterAll(() => {
		realFs.rmSync(ws, { recursive: true, force: true });
	});

	it("runs an entry that imports each kind", () => {
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
		expect(result.stdout, result.stderr).toContain("hello mts 3 <b>tsx</b>");
		expect(result.status, result.stderr).toBe(0);
	});
}, 60_000);
