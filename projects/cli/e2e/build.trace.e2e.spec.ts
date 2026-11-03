import path from "node:path";
import { fileURLToPath } from "node:url";
import { ForgeModule } from "@decohere/forge";
import { Caching } from "@decohere/core/caching";
import { scribe } from "@decohere/scribe";
import { PinoAdapter } from "@decohere/scribe-pino";
import { describe, it } from "vitest";
import { RootModule } from "../src/root.module.js";

const BENCH_FIXTURE_ROOT = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"__fixtures__/bench",
);
const BENCH_CONFIG_FILE = path.join(BENCH_FIXTURE_ROOT, ".decohere.js");
const iterations = process.env.BENCH_ITERATIONS ? Number(process.env.BENCH_ITERATIONS) : 1;
const selectedConfig = process.env.BENCH_CONFIGURATION ?? "types-only";
const noCleanBetweenRuns = process.env.BENCH_NO_CLEAN_BETWEEN_RUNS === "1";

if (process.env.FORGE_TRACE != null && process.env.FORGE_TRACE_STRUCTURED === "1") {
	scribe.configure({
		adapter: new PinoAdapter({}),
		options: { logLevel: "trace" },
	});
}

async function runBuild(configuration: "local" | "debug" | "types-only") {
	for (let i = 0; i < iterations; i++) {
		Caching.flushAllCaches();
		const app = await RootModule.create([ForgeModule], {
			rootDir: BENCH_FIXTURE_ROOT,
			configFile: BENCH_CONFIG_FILE,
		});
		const args = ["forge", "build", "--configuration", configuration];
		if (noCleanBetweenRuns && i > 0) {
			args.push("--no-clean");
		}
		await app.run(args);
	}
}

describe("BuildService trace", () => {
	if (selectedConfig === "all" || selectedConfig === "types-only") {
		it(
			"types only",
			async () => {
				await runBuild("types-only");
			},
			Math.max(120_000, iterations * 120_000),
		);
	}

	if (selectedConfig === "all" || selectedConfig === "debug") {
		it(
			"es6 only",
			async () => {
				await runBuild("debug");
			},
			Math.max(120_000, iterations * 120_000),
		);
	}

	if (selectedConfig === "all" || selectedConfig === "local") {
		it(
			"es6 + types",
			async () => {
				await runBuild("local");
			},
			Math.max(120_000, iterations * 120_000),
		);
	}
});
