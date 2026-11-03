import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

// Runs the real `flux` bin in a child process, the way users run it.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const root = fileURLToPath(new URL("../../../", import.meta.url));
// Inside a workspace project, so flux compiles the fixtures with SWC. Files outside every
// project fall through to Node's strip-only TypeScript, which keeps positions unchanged
// and would hide a broken source map.
const dir = realFs.mkdtempSync(join(root, "projects/cli/tests/.flux-bin-"));

function fluxRun(fileName: string, source: string) {
	const file = join(dir, fileName);
	realFs.writeFileSync(file, source);
	return spawnSync(
		process.execPath,
		["--import", "./tools/register.mjs", "projects/cli/src/flux.ts", "run", file],
		{ cwd: root, encoding: "utf8", timeout: 30_000 },
	);
}

// Fails with the child's output, so a timeout, crash or loader error is diagnosable.
function expectExit(result: ReturnType<typeof fluxRun>, status: number) {
	const output = `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
	expect(result.error, output).toBeUndefined();
	expect(result.signal, output).toBeNull();
	expect(result.status, output).toBe(status);
}

// SWC drops the TypeScript-only lines (interface, type, annotations), so the compiled
// `throw` lands at 2:11 while the source has it at 9:8. Only a working source map
// reports the source position.
const throwingSource = `interface Point {
	x: number;
	y: number;
}

type Id = string;

function fail(point: Point, id: Id): never {
	throw new Error(\`boom at \${point.x},\${point.y} (\${id})\`);
}

fail({ x: 1, y: 2 }, "a");
`;

describe("flux run (real process)", () => {
	afterAll(() => {
		realFs.rmSync(dir, { recursive: true, force: true });
	});

	it("lets pending timers finish before exiting, then exits 0", () => {
		const result = fluxRun(
			"timer.ts",
			'setTimeout(() => console.log("timer ran"), 50);\nconsole.log("main done");\n',
		);

		expectExit(result, 0);
		expect(result.stdout).toContain("main done");
		expect(result.stdout).toContain("timer ran");
	});

	it("exits 1 when the script throws, reporting TypeScript source locations", () => {
		const result = fluxRun("stack.ts", throwingSource);
		const output = result.stdout + result.stderr;

		expectExit(result, 1);
		// The interpolated message never appears in the source text, so an echoed
		// source line cannot satisfy this.
		expect(output).toContain("Error: boom at 1,2 (a)");
		expect(output).toMatch(/at fail \([^)\s]*stack\.ts:9:8\)/);
		expect(output).toMatch(/\([^)\s]*stack\.ts:12:1\)/);
	});

	// Only commands that run until stopped (`flux serve`) hold stop signals for a clean
	// shutdown; a one-off run still ends at once, as Node's default does.
	it("ends at once on SIGTERM while the script is still running", async () => {
		const file = join(dir, "long.ts");
		realFs.writeFileSync(file, 'console.log("running");\nsetTimeout(() => {}, 30_000);\n');
		const child = spawn(
			process.execPath,
			["--import", "./tools/register.mjs", "projects/cli/src/flux.ts", "run", file],
			{ cwd: root },
		);
		await new Promise<void>((resolve) => {
			child.stdout?.on("data", (chunk: Buffer) => {
				if (chunk.toString().includes("running")) resolve();
			});
		});
		const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
			child.once("exit", (code, signal) => resolve({ code, signal })),
		);
		const sentAt = Date.now();
		child.kill("SIGTERM");

		expect(await exited).toEqual({ code: null, signal: "SIGTERM" });
		expect(Date.now() - sentAt).toBeLessThan(5_000);
	});
}, 60_000);
