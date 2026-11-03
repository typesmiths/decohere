import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Runs the real `flux serve` against real files: Node's resolver checks the real disk,
// so a file that appears after boot can't be simulated in memfs.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const ws = realFs.mkdtempSync(join(tmpdir(), "decohere-flux-serve-"));

function write(relativePath: string, content: string) {
	const file = join(ws, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, content);
}

let child: ChildProcess | undefined;
let output = "";

function fluxServe(args = ["--reboot-debounce-ms", "50"]) {
	output = "";
	child = spawn(
		process.execPath,
		[
			"--import",
			join(repo, "tools/register.mjs"),
			join(repo, "projects/cli/src/flux.ts"),
			"serve",
			...args,
		],
		{ cwd: ws },
	);
	child.stdout?.on("data", (chunk) => {
		output += chunk;
	});
	child.stderr?.on("data", (chunk) => {
		output += chunk;
	});
}

function count(text: string) {
	return output.split(text).length - 1;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForOutput(text: string, timeoutMs = 20_000) {
	const start = Date.now();
	while (!output.includes(text)) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out waiting for "${text}". Output:\n${output}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

describe("flux serve (real process)", () => {
	beforeAll(() => {
		write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
		write(
			"projects/app/package.json",
			JSON.stringify({ name: "@ws/app", type: "module", main: "src/main.ts" }),
		);
	});

	afterEach(() => {
		child?.kill("SIGKILL");
		child = undefined;
	});

	afterAll(() => {
		realFs.rmSync(ws, { recursive: true, force: true });
	});

	// The import of a missing file fails before any dependency edge is recorded, so
	// creating that file was never seen as affecting the entry.
	it("boots the entry once the missing file it imports is created", async () => {
		write(
			"projects/app/src/main.ts",
			`import { value } from "./config.js";
console.log(\`booted with \${value}\`);
export default { async [Symbol.asyncDispose]() {} };
`,
		);
		fluxServe();
		await waitForOutput("error booting the entry point");

		write("projects/app/src/config.ts", "export const value = 5;\n");

		await waitForOutput("booted with 5");
		expect(output).toContain("booted with 5");
	});

	// Only SIGINT was handled; SIGTERM (Docker, CI, process managers) killed flux
	// without disposing the app.
	it("disposes the app and exits 0 on SIGTERM", async () => {
		write(
			"projects/app/src/main.ts",
			`console.log("app started");
export default {
	async [Symbol.asyncDispose]() {
		console.log("app disposed");
	},
};
`,
		);
		fluxServe();
		await waitForOutput("app started");

		const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
			child?.once("exit", (code, signal) => resolve({ code, signal })),
		);
		child?.kill("SIGTERM");

		expect(await exited).toEqual({ code: 0, signal: null });
		expect(output).toContain("app disposed");
	});

	// flux listened for stop signals only once `flux serve` had booted, so a SIGTERM during boot
	// (`docker stop` while starting, or a test right after the app's first log line) killed it
	// without disposing the app.
	it("disposes the app and exits 0 on a SIGTERM that arrives while it boots", async () => {
		write(
			"projects/app/src/main.ts",
			`console.log("app booting");
await new Promise((resolve) => setTimeout(resolve, 1000));
console.log("app started");
export default {
	async [Symbol.asyncDispose]() {
		console.log("app disposed");
	},
};
`,
		);
		fluxServe();
		await waitForOutput("app booting");

		const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
			child?.once("exit", (code, signal) => resolve({ code, signal })),
		);
		child?.kill("SIGTERM");

		expect(await exited).toEqual({ code: 0, signal: null });
		expect(output).toContain("app disposed");
	});

	// An agent renames an export and then fixes each caller. Saves made in one go (parallel
	// edits, a formatter, a checkout) land inside the default window and reboot once.
	describe("an agent renames an export used by three files", () => {
		const lib = (name: string) => `export function ${name}(x: number) { return x + 1; }\n`;
		const caller = (i: number, name: string) =>
			`import { ${name} } from "./lib.js";\nexport const v${i} = ${name}(${i});\n`;

		function writeApp() {
			write("projects/app/src/lib.ts", lib("oldName"));
			for (const i of [0, 1, 2]) write(`projects/app/src/c${i}.ts`, caller(i, "oldName"));
			write(
				"projects/app/src/main.ts",
				`import { v0 } from "./c0.js";
import { v1 } from "./c1.js";
import { v2 } from "./c2.js";
console.log(\`sum is \${v0 + v1 + v2}\`);
export default { async [Symbol.asyncDispose]() {} };
`,
			);
		}

		async function rename(gapMs: number) {
			write("projects/app/src/lib.ts", lib("newName"));
			for (const i of [0, 1, 2]) {
				await sleep(gapMs);
				write(`projects/app/src/c${i}.ts`, caller(i, "newName"));
			}
		}

		it("reboots once when the saves land together", async () => {
			writeApp();
			fluxServe([]);
			await waitForOutput("sum is 6");

			await rename(20);
			await waitForOutput("FLUX READY");
			await sleep(1000);

			expect(count("FLUX REBOOT")).toBe(1);
			expect(output).not.toContain("error booting the entry point");
		});

		// Saves an agent makes one tool call at a time are seconds apart, beyond any window short
		// enough for a person's save. Each reboot in between fails; the app must still end up on
		// the last version.
		it("ends on the last version when each save reboots on its own", async () => {
			writeApp();
			fluxServe([]);
			await waitForOutput("sum is 6");
			output = "";

			await rename(500);
			await waitForOutput("sum is 6");

			// Four saves; a save during a reboot folds into one follow-up, so a loaded host may see fewer.
			expect(count("FLUX REBOOT")).toBeGreaterThan(1);
			expect(count("error booting the entry point")).toBeGreaterThan(0);
		});
	});
}, 60_000);
