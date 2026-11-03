import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ForgeModule } from "@decohere/forge";
import { Caching } from "@decohere/core/caching";
import { scribe } from "@decohere/scribe";
import { PinoAdapter } from "@decohere/scribe-pino";
import { beforeEach, bench, describe } from "vitest";
import { RootModule } from "../src/root.module.js";

const BENCH_FIXTURE_ROOT = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"__fixtures__/bench",
);
const BENCH_FIXTURE_PROJECTS = path.join(BENCH_FIXTURE_ROOT, "projects");
const BENCH_CONFIG_FILE = path.join(BENCH_FIXTURE_ROOT, ".decohere.js");

function countFixtureFiles(directory: string): number {
	let total = 0;
	for (const dirent of readdirSync(directory, { withFileTypes: true })) {
		const fullPath = path.join(directory, dirent.name);
		if (dirent.isDirectory()) {
			total += countFixtureFiles(fullPath);
			continue;
		}
		total += 1;
	}
	return total;
}

const fixtureFileCount = countFixtureFiles(BENCH_FIXTURE_PROJECTS);

// Exactly BENCH_SAMPLES runs (`time: 0`): tinybench otherwise keeps sampling for 500 ms, so
// fast configurations got many more samples than slow ones.
const iterations = Number(process.env.BENCH_SAMPLES ?? 10);
const selectedConfig = process.env.BENCH_CONFIGURATION ?? "all";
const isTraceMode = process.env.FORGE_TRACE != null;
const warmupIterations = isTraceMode ? 0 : undefined;
const noCleanBetweenRuns = process.env.BENCH_NO_CLEAN_BETWEEN_RUNS === "1";
let localRuns = 0;
let debugRuns = 0;
let typesOnlyRuns = 0;

// Benchmark trace mode should emit structured JSON logs for machine analysis.
if (process.env.FORGE_TRACE != null && process.env.FORGE_TRACE_STRUCTURED === "1") {
	scribe.configure({
		adapter: new PinoAdapter({}),
		options: { logLevel: "trace" },
	});
}

describe("BuildService benchmark (forge fixtures, real disk)", () => {
	beforeEach(() => {
		Caching.flushAllCaches();
	});

	if (selectedConfig === "all" || selectedConfig === "local") {
		bench(
			`forge build es6 + types (${fixtureFileCount} files)`,
			async () => {
				const app = await RootModule.create([ForgeModule], {
					rootDir: BENCH_FIXTURE_ROOT,
					configFile: BENCH_CONFIG_FILE,
				});
				const args = ["forge", "build", "--configuration", "local"];
				if (noCleanBetweenRuns && localRuns > 0) {
					args.push("--no-clean");
				}
				localRuns += 1;
				await app.run(args);
			},
			{ iterations, warmupIterations, time: 0 },
		);
	}

	if (selectedConfig === "all" || selectedConfig === "debug") {
		bench(
			`forge build es6 only (${fixtureFileCount} files)`,
			async () => {
				const app = await RootModule.create([ForgeModule], {
					rootDir: BENCH_FIXTURE_ROOT,
					configFile: BENCH_CONFIG_FILE,
				});
				const args = ["forge", "build", "--configuration", "debug"];
				if (noCleanBetweenRuns && debugRuns > 0) {
					args.push("--no-clean");
				}
				debugRuns += 1;
				await app.run(args);
			},
			{ iterations, warmupIterations, time: 0 },
		);
	}

	if (selectedConfig === "all" || selectedConfig === "types-only") {
		bench(
			`forge build types only (${fixtureFileCount} files)`,
			async () => {
				const app = await RootModule.create([ForgeModule], {
					rootDir: BENCH_FIXTURE_ROOT,
					configFile: BENCH_CONFIG_FILE,
				});
				const args = ["forge", "build", "--configuration", "types-only"];
				if (noCleanBetweenRuns && typesOnlyRuns > 0) {
					args.push("--no-clean");
				}
				typesOnlyRuns += 1;
				await app.run(args);
			},
			{ iterations, warmupIterations, time: 0 },
		);
	}
});
