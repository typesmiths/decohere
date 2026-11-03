/**
 * Load benchmark for flux: how long the load hook takes to compile and import a workspace whose
 * files import each other, the way an app's do. Measures what a user's app pays at
 * startup, without the cost of running the flux CLI itself from source.
 *
 *   pnpm bench flux-load                    # 8 libraries × 40 files, 10 processes
 *   BENCH_LIBS=4 BENCH_FILES=100 BENCH_SAMPLES=5 pnpm bench flux-load
 *
 * Each process imports the last library twice under different URL versions with a fresh loader
 * cache, so both loads transpile every file: the first is a real cold start (`flux.load.cold`),
 * the second runs with Node and SWC warmed up (`flux.load.warm`), as a reboot after a save does.
 * Both run with the disk cache off. `flux.load.cold-cached` is a cold process whose disk cache a
 * previous run filled, as when an app restarts with nothing changed.
 *
 * The cold load is also split into where its time goes, so a change shows which part moved:
 * `flux.load.cold.swc` (SWC: the up-front parallel compile plus any file the load hook compiles), `.resolve` (the resolve hooks, flux's and
 * Node's), `.load-other` (the rest of the load hook: reading files, the cache) and `.link-eval`
 * (what is left of the import: Node linking and evaluating the modules). The parts are timed by
 * hooks registered after flux's, which run first and time everything inside `next()`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspace, SwcTranspiler } from "@decohere/forge";
import { SourceModuleLoader } from "../src/source-module-loader.js";
import { benchStats, benchWorkspace, defaultShape, samples as runs } from "./harness.js";

type Parts = { swc: number; resolve: number; loadOther: number; linkEval: number };
type Sample = { files: number; cold: number; warm: number; parts: Parts };

/** Times SWC, the resolve hooks and the load hooks of every import until `stop()`. */
function timeParts() {
	const totals = { swc: 0, resolve: 0, load: 0 };
	// The up-front compile runs its files concurrently, so its share is the wall-clock span
	// from the first async compile starting to the last one finishing, not the sum of the calls.
	const parallel = { first: Number.POSITIVE_INFINITY, last: 0 };
	const transformCode = SwcTranspiler.prototype.transformCode;
	SwcTranspiler.prototype.transformCode = async function (
		this: SwcTranspiler,
		...args: Parameters<typeof transformCode>
	) {
		parallel.first = Math.min(parallel.first, performance.now());
		try {
			return await transformCode.apply(this, args);
		} finally {
			parallel.last = Math.max(parallel.last, performance.now());
		}
	};
	const transformCodeSync = SwcTranspiler.prototype.transformCodeSync;
	SwcTranspiler.prototype.transformCodeSync = function (
		this: SwcTranspiler,
		...args: Parameters<typeof transformCodeSync>
	) {
		const started = performance.now();
		try {
			return transformCodeSync.apply(this, args);
		} finally {
			totals.swc += performance.now() - started;
		}
	};
	const hooks = registerHooks({
		resolve(specifier, context, next) {
			const started = performance.now();
			try {
				return next(specifier, context);
			} finally {
				totals.resolve += performance.now() - started;
			}
		},
		load(url, context, next) {
			const started = performance.now();
			try {
				return next(url, context);
			} finally {
				totals.load += performance.now() - started;
			}
		},
	});
	return {
		stop(importMs: number): Parts {
			hooks.deregister();
			SwcTranspiler.prototype.transformCodeSync = transformCodeSync;
			SwcTranspiler.prototype.transformCode = transformCode;
			const upFront = Math.max(0, parallel.last - parallel.first);
			return {
				swc: totals.swc + upFront,
				resolve: totals.resolve,
				loadOther: totals.load - totals.swc,
				linkEval: importMs - upFront - totals.resolve - totals.load,
			};
		},
	};
}

/**
 * One load, in this process, of the workspace the parent generated (BENCH_ROOT): the first
 * import (cold) and a second one (warm Node and SWC).
 */
async function sample(): Promise<Sample> {
	const root = process.env.BENCH_ROOT;
	if (root == null) throw new Error("BENCH_ROOT is not set");
	{
		const entry = path.join(root, "projects", `lib-${defaultShape.libs - 1}`, "src/index.ts");
		const workspace = await createWorkspace({ rootDir: root });
		const loader = new SourceModuleLoader();
		// `timed` starts the part timers after flux registers its hooks: hooks registered later
		// run first, so ours wrap flux's.
		const load = async (version: number, timed = false) => {
			const started = performance.now();
			await loader.configure({
				buildConfig: "debug",
				workspace,
				versionFileUrl: (fileUrl) => `${fileUrl}?v=${version}`,
			});
			loader.registerHooks();
			const timer = timed ? timeParts() : undefined;
			const importStarted = performance.now();
			await loader.importEntry(entry);
			const importMs = performance.now() - importStarted;
			if (timer != null) parts = timer.stop(importMs);
			return performance.now() - started;
		};
		let parts: Parts | undefined;
		const cold = await load(1, true);
		const warm = await load(2);
		if (parts == null) throw new Error("the cold load finished without timing its parts");
		return { files: [...loader.sourceFilePaths()].length, cold, warm, parts };
	}
}

if (process.argv.includes("--sample")) {
	console.log(JSON.stringify(await sample()));
} else {
	// Each load runs in a fresh process: Node never unloads modules, so loads in one process
	// slow down as the heap grows and the numbers drift.
	const load = (env: Record<string, string>): Sample => {
		const child = spawnSync(
			process.execPath,
			[...process.execArgv, fileURLToPath(import.meta.url), "--sample"],
			{ encoding: "utf8", env: { ...process.env, ...env } },
		);
		if (child.status !== 0) throw new Error(`sample failed:\n${child.stderr}`);
		const last = child.stdout.trim().split("\n").at(-1) ?? "";
		return JSON.parse(last) as Sample;
	};
	const samples: Sample[] = [];
	const coldCached: number[] = [];
	for (let run = 0; run < runs; run++) {
		const root = mkdtempSync(path.join(tmpdir(), "flux-bench-"));
		const cacheDir = mkdtempSync(path.join(tmpdir(), "flux-bench-cache-"));
		try {
			benchWorkspace.generate(root);
			// Without the disk cache, so these stay comparable with runs before it.
			samples.push(load({ BENCH_ROOT: root, DECOHERE_CACHE: "0" }));
			// A first run fills the cache; a fresh process then starts from it, as a restart does.
			load({ BENCH_ROOT: root, DECOHERE_CACHE_DIR: cacheDir });
			coldCached.push(load({ BENCH_ROOT: root, DECOHERE_CACHE_DIR: cacheDir }).cold);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(cacheDir, { recursive: true, force: true });
		}
	}
	const files = samples[0]?.files ?? 0;
	benchStats.report([
		benchStats.summarize(
			"flux.load.cold",
			"flux load, first import (cold process)",
			samples.map((s) => s.cold),
			files,
		),
		benchStats.summarize(
			"flux.load.cold-cached",
			"flux load, first import, disk cache from a previous run",
			coldCached,
			files,
		),
		benchStats.summarize(
			"flux.load.warm",
			"flux load, second import (warm process)",
			samples.map((s) => s.warm),
			files,
		),
		...(
			[
				["swc", "swc", "cold load: SWC"],
				["resolve", "resolve", "cold load: resolving imports"],
				["loadOther", "load-other", "cold load: rest of the load hook"],
				["linkEval", "link-eval", "cold load: Node linking and evaluating"],
			] as const
		).map(([part, suffix, label]) =>
			benchStats.summarize(
				`flux.load.cold.${suffix}`,
				label,
				samples.map((s) => s.parts[part]),
				files,
			),
		),
	]);
}
