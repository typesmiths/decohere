import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A project with no tsconfig.json has made no choices, so forge typecheck reads it as plain
// tsc would, plus the decorators flux compiles by default. It used to fail on forge's own
// defaults: a `baseUrl` TypeScript 6 rejects, and no `console` without a `lib` or `@types/node`.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const dir = realFs.mkdtempSync(join(tmpdir(), "decohere-forge-typecheck-"));

const SOURCE = `enum Level {
	Info = "info",
}
function tag(_target: unknown, _key: string | symbol | undefined, _index: number) {}
class App {
	public constructor(@tag private readonly name: string) {}
	public greet(): string {
		return \`[\${Level.Info}] Hello, \${this.name}!\`;
	}
}
console.log(new App("Ada").greet());
`;

function typecheck() {
	return spawnSync(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/cli/src/forge.ts"),
			"typecheck",
		],
		{ cwd: dir, encoding: "utf8", timeout: 60_000 },
	);
}

describe("forge typecheck with no tsconfig.json (real process)", () => {
	beforeAll(() => {
		realFs.mkdirSync(join(dir, "src"));
		realFs.writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ name: "solo", version: "1.0.0", type: "module" }),
		);
	});

	afterAll(() => {
		realFs.rmSync(dir, { recursive: true, force: true });
	});

	it("passes a file flux can run: console, an enum, a parameter decorator", () => {
		realFs.writeFileSync(join(dir, "src/index.ts"), SOURCE);

		const result = typecheck();

		expect(result.status, result.stdout + result.stderr).toBe(0);
	});

	it("still fails on a real type error", () => {
		realFs.writeFileSync(join(dir, "src/index.ts"), `export const x: number = "nope";\n`);

		const result = typecheck();

		expect(result.status).toBe(1);
		expect(result.stdout + result.stderr).toContain("TS2322");
		expect(result.stdout + result.stderr).not.toContain("TS5101");
	});
});
