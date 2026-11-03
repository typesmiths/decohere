/**
 * Real-process benchmark for `flux serve`: start-up and reload after a save, measured from the
 * outside the way a developer sees them.
 *
 *   pnpm bench flux-serve
 *   BENCH_SAMPLES=3 pnpm bench flux-serve
 *
 * - `flux.serve.start`: from spawning `flux serve` until the app prints that it is ready. This
 *   runs the flux CLI from source, as this repo does, so it includes compiling the CLI itself;
 *   `flux.load.cold` is the app's share alone.
 * - `flux.serve.reload-root` / `reload-leaf`: from writing a file until the rebooted app is
 *   ready. The root edit is the first model of the first library, which every other file
 *   depends on; the leaf edit is the last model of the last library. The debounce is 0 so the
 *   numbers are the watcher plus the reboot, not the quiet window.
 *
 * Each process gives one sample of each: a start, then one root and one leaf reload.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { benchStats, benchWorkspace, defaultShape, samples } from "./harness.js";

const timeoutMs = 60_000;

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const READY = "flux-bench ready";

/** The generated workspace plus an app that imports every library and prints a numbered line. */
function writeApp(root: string) {
	benchWorkspace.generate(root);
	const dir = path.join(root, "projects", "app");
	mkdirSync(path.join(dir, "src"), { recursive: true });
	writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ name: "@bench/app", type: "module", main: "src/main.ts" }),
	);
	writeFileSync(
		path.join(dir, "src/main.ts"),
		[
			`import * as models from "@bench/lib-${defaultShape.libs - 1}";`,
			`const state = globalThis as { fluxBenchBoots?: number };`,
			`state.fluxBenchBoots = (state.fluxBenchBoots ?? 0) + 1;`,
			`console.log(\`${READY} \${state.fluxBenchBoots} \${Object.keys(models).length}\`);`,
			`export default { async [Symbol.asyncDispose]() {} };`,
		].join("\n"),
	);
}

/** A running `flux serve`, with a way to wait for its n-th ready line. */
class FluxServe {
	private output = "";
	private readonly child: ChildProcess;
	private waiter?: { boots: number; resolve: () => void };

	public constructor(cwd: string) {
		this.child = spawn(
			process.execPath,
			[
				"--import",
				path.join(repo, "tools/register.mjs"),
				path.join(repo, "projects/cli/src/flux.ts"),
				"serve",
				"--reboot-debounce-ms",
				"0",
			],
			{ cwd, env: { ...process.env, NODE_OPTIONS: "" } },
		);
		const onData = (chunk: Buffer) => {
			this.output += chunk.toString();
			this.check();
		};
		this.child.stdout?.on("data", onData);
		this.child.stderr?.on("data", onData);
	}

	private boots(): number {
		const matches = [...this.output.matchAll(new RegExp(`${READY} (\\d+)`, "g"))];
		return Number(matches.at(-1)?.[1] ?? 0);
	}

	private check() {
		if (this.waiter != null && this.boots() >= this.waiter.boots) this.waiter.resolve();
	}

	/** Resolves once the app has booted `boots` times; fails with the output on timeout or exit. */
	public waitForBoot(boots: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`timed out waiting for boot ${boots}:\n${this.output}`)),
				timeoutMs,
			);
			const onExit = (code: number | null) =>
				reject(new Error(`flux serve exited (${code}) before boot ${boots}:\n${this.output}`));
			this.child.once("exit", onExit);
			this.waiter = {
				boots,
				resolve: () => {
					clearTimeout(timer);
					this.child.off("exit", onExit);
					this.waiter = undefined;
					resolve();
				},
			};
			this.check();
		});
	}

	public async stop(): Promise<void> {
		if (this.child.exitCode != null) return;
		const exited = new Promise((resolve) => this.child.once("exit", resolve));
		this.child.kill("SIGTERM");
		await exited;
	}
}

const start: number[] = [];
const reloadRoot: number[] = [];
const reloadLeaf: number[] = [];
let revision = 0;

for (let run = 0; run < samples; run++) {
	const root = mkdtempSync(path.join(tmpdir(), "flux-serve-bench-"));
	try {
		writeApp(root);
		const startedAt = performance.now();
		const serve = new FluxServe(root);
		try {
			await serve.waitForBoot(1);
			start.push(performance.now() - startedAt);
			let boots = 1;
			const edits = [
				{ into: reloadRoot, lib: 0, file: 0 },
				{ into: reloadLeaf, lib: defaultShape.libs - 1, file: defaultShape.filesPerLib - 1 },
			];
			for (const edit of edits) {
				const savedAt = performance.now();
				benchWorkspace.touchModel(root, edit.lib, edit.file, ++revision);
				boots += 1;
				await serve.waitForBoot(boots);
				edit.into.push(performance.now() - savedAt);
			}
		} finally {
			await serve.stop();
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const files = defaultShape.libs * (defaultShape.filesPerLib + 2) + 1;
benchStats.report([
	benchStats.summarize(
		"flux.serve.start",
		"flux serve, spawn to app ready (CLI from source)",
		start,
		files,
	),
	benchStats.summarize(
		"flux.serve.reload-root",
		"flux serve, save to ready, file everything imports",
		reloadRoot,
		files,
	),
	benchStats.summarize(
		"flux.serve.reload-leaf",
		"flux serve, save to ready, file only its barrel imports",
		reloadLeaf,
		files,
	),
]);
