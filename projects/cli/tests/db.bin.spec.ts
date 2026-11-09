import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `decohere db` finds an API's src/db.ts in the workspace and runs it, passing the rest of the
// command line through, so a developer types `pnpm decohere db migrate` rather than a path.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const parent = realFs.mkdtempSync(join(tmpdir(), "decohere-db-"));

/** A db.ts that prints which API it is and the arguments it was given. */
const DB_TS = (api: string) => `const args: string[] = process.argv.slice(2);
console.log(JSON.stringify({ api: "${api}", args, secret: process.env.DB_SPEC_VALUE ?? null }));
`;

function workspace(name: string, apis: string[]): string {
	const ws = join(parent, name);
	const write = (relativePath: string, content: string) => {
		const file = join(ws, relativePath);
		realFs.mkdirSync(join(file, ".."), { recursive: true });
		realFs.writeFileSync(file, content);
	};
	write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
	write("tsconfig.json", JSON.stringify({ compilerOptions: { module: "nodenext" } }));
	write(
		"projects/lib/package.json",
		JSON.stringify({ name: "@ws/lib", type: "module", main: "src/index.ts" }),
	);
	write("projects/lib/src/index.ts", "export const lib = 1;\n");
	for (const api of apis) {
		write(
			`projects/${api}/package.json`,
			JSON.stringify({ name: `@ws/${api}`, type: "module", main: "src/main.ts" }),
		);
		write(`projects/${api}/src/main.ts`, "export {};\n");
		write(`projects/${api}/src/db.ts`, DB_TS(api));
	}
	return ws;
}

function decohere(cwd: string, ...argv: string[]) {
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/cli/src/cli.ts"),
			...argv,
		],
		{ cwd, encoding: "utf8", timeout: 30_000 },
	);
	const line = result.stdout.split("\n").find((l) => l.startsWith('{"api"'));
	return { ...result, ran: line ? JSON.parse(line) : undefined };
}

describe("decohere db (real process)", () => {
	let one: string;
	let two: string;

	beforeAll(() => {
		one = workspace("one", ["api"]);
		two = workspace("two", ["shop", "admin"]);
	});

	afterAll(() => {
		realFs.rmSync(parent, { recursive: true, force: true });
	});

	it("runs the only API's db.ts with the command and its options", () => {
		const { status, ran } = decohere(
			one,
			"db",
			"migrate",
			"--to",
			"20261108-120000-x",
			"--dry-run",
		);
		expect(ran).toEqual({
			api: "api",
			args: ["migrate", "--to", "20261108-120000-x", "--dry-run"],
			secret: null,
		});
		expect(status).toBe(0);
	});

	it("passes options that come before the command through too", () => {
		const { ran } = decohere(one, "db", "--data-source", "reporting", "status");
		expect(ran?.args).toEqual(["--data-source", "reporting", "status"]);
	});

	it("picks an API by folder or package name with --api, wherever it comes", () => {
		expect(decohere(two, "db", "--api", "shop", "status").ran).toEqual({
			api: "shop",
			args: ["status"],
			secret: null,
		});
		expect(decohere(two, "db", "new", "backfill", "--data", "--api", "@ws/admin").ran).toEqual(
			{
				api: "admin",
				args: ["new", "backfill", "--data"],
				secret: null,
			},
		);
	});

	it("asks which API when there are several, and names them", () => {
		const { status, ran, stdout, stderr } = decohere(two, "db", "status");
		expect(ran).toBeUndefined();
		expect(status).toBe(1);
		expect(stdout + stderr).toMatch(/--api/);
		expect(stdout + stderr).toMatch(/admin/);
		expect(stdout + stderr).toMatch(/shop/);
	});

	it("says so when the named API has no db.ts", () => {
		const { status, ran, stdout, stderr } = decohere(two, "db", "--api", "lib", "status");
		expect(ran).toBeUndefined();
		expect(status).toBe(1);
		expect(stdout + stderr).toMatch(/lib/);
	});

	it("loads a .env file only when the command line names one", () => {
		realFs.writeFileSync(join(one, ".env"), "DB_SPEC_VALUE=from-file\n");
		expect(decohere(one, "db", "status").ran?.secret).toBeNull();
		expect(decohere(one, "--env-file-if-exists", ".env", "db", "status").ran?.secret).toBe(
			"from-file",
		);
		expect(decohere(one, "db", "status", "--env-file-if-exists", ".env").ran).toEqual({
			api: "api",
			args: ["status"],
			secret: "from-file",
		});
	});
}, 120_000);
