#!/usr/bin/env node

/**
 * bench.mjs — run the benchmark suites and compare against the last saved run.
 *
 * Usage:
 *   pnpm bench                          — run every suite and compare, do not save
 *   pnpm bench flux-load flux-serve     — run only these suites
 *   pnpm bench:save                     — run, compare, and append to the history
 *
 * Suites: forge-build, flux-load, flux-transpile, flux-serve, flux-run. Each prints a BENCH_RESULT line
 * (see history.mjs). The history lives in projects/ci-tools/dist/ci/bench/bench-history.json;
 * the nightly bench workflow restores it from Pages, saves, and publishes the charts.
 *
 * Environment: BENCH_HISTORY_FILE overrides where `save` writes; BENCH_ENV names the machine class (CI sets gh-actions); BENCH_SAMPLES (default
 * 10) is the sample count for every benchmark; BENCH_LIBS and BENCH_FILES size the flux workspace.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import {
	appendRun,
	assertValid,
	compare,
	contextId,
	formatComparison,
	fromVitest,
	getContext,
	normalize,
	parseResults,
	previousRun,
} from "./history.mjs";

const WORKSPACE_ROOT = process.cwd();
// BENCH_HISTORY_FILE lets the nightly job save each comparison round to its own file.
const HISTORY_FILE =
	process.env.BENCH_HISTORY_FILE ??
	join(WORKSPACE_ROOT, "projects/ci-tools/dist/ci/bench/bench-history.json");

/** Runs a TypeScript benchmark from source, the way the repo runs its CLIs. */
function fluxSuite(file) {
	return () => {
		const result = spawnSync(process.execPath, ["--import", "./tools/register.mjs", file], {
			cwd: WORKSPACE_ROOT,
			encoding: "utf8",
			maxBuffer: 1024 * 1024 * 50,
			env: { ...process.env, NODE_OPTIONS: "" },
		});
		process.stderr.write(
			result.stdout
				.split("\n")
				.filter((l) => !l.startsWith("BENCH_RESULT"))
				.join("\n"),
		);
		if (result.status !== 0) {
			throw new Error(`${file} exited ${result.status ?? result.signal}:\n${result.stderr}`);
		}
		return parseResults(result.stdout, file);
	};
}

function forgeBuildSuite() {
	const tmpDir = mkdtempSync(join(os.tmpdir(), "decohere-bench-"));
	const outJson = join(tmpDir, "output.json");
	try {
		const result = spawnSync(
			join(WORKSPACE_ROOT, "node_modules/.bin/vitest"),
			[
				"bench",
				"--config",
				join(WORKSPACE_ROOT, "vitest.config.ts"),
				"--project",
				"e2e",
				"--run",
				"--outputJson",
				outJson,
				"projects/cli/e2e/build.benchmark.bench.ts",
			],
			{
				cwd: WORKSPACE_ROOT,
				stdio: ["ignore", "inherit", "inherit"],
				env: {
					...process.env,
					NODE_OPTIONS: "",
				},
			},
		);
		if (result.status !== 0) throw new Error(`vitest bench exited ${result.status}`);
		// vitest swallows errors in bench callbacks, so a missing file means it failed.
		if (!existsSync(outJson)) throw new Error("vitest bench wrote no output JSON");
		return fromVitest(JSON.parse(readFileSync(outJson, "utf8")));
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

const SUITES = {
	"forge-build": forgeBuildSuite,
	"flux-load": fluxSuite("projects/flux/bench/load.bench.ts"),
	"flux-transpile": fluxSuite("projects/flux/bench/transpile.bench.ts"),
	"flux-serve": fluxSuite("projects/flux/bench/serve.bench.ts"),
	"flux-run": fluxSuite("projects/flux/bench/run.bench.ts"),
};

function currentSha() {
	if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
	return execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: WORKSPACE_ROOT,
		encoding: "utf8",
	}).trim();
}

const [command = "run", ...requested] = process.argv.slice(2);
if (command !== "run" && command !== "save") {
	process.stderr.write(`Unknown command "${command}". Use "run" or "save".\n`);
	process.exit(1);
}
const unknown = requested.filter((suite) => !(suite in SUITES));
if (unknown.length > 0) {
	process.stderr.write(
		`Unknown suite(s): ${unknown.join(", ")}. Available: ${Object.keys(SUITES).join(", ")}\n`,
	);
	process.exit(1);
}
const suites = requested.length > 0 ? requested : Object.keys(SUITES);

const ctx = getContext(os, process.env, process.version);
const id = contextId(ctx);
process.stderr.write(
	[
		"",
		`Context ${id} · ${ctx.benchEnv} · ${ctx.os.platform} ${ctx.os.arch}`,
		`${ctx.cpu.model} × ${ctx.cpu.count} · ${ctx.memoryGb} GB · Node ${ctx.node}`,
		`Suites: ${suites.join(", ")}`,
		"",
		"",
	].join("\n"),
);

const results = [];
for (const suite of suites) {
	process.stderr.write(`── ${suite}\n`);
	results.push(...SUITES[suite]());
	process.stderr.write("\n");
}
assertValid(results);

const history = normalize(
	existsSync(HISTORY_FILE) ? JSON.parse(readFileSync(HISTORY_FILE, "utf8")) : null,
);
const previous = previousRun(history, id);
process.stderr.write(
	previous == null
		? "No saved run for this machine yet; nothing to compare against.\n"
		: `Compared with the saved run from ${previous.date}:\n`,
);
process.stderr.write(`${formatComparison(compare(results, previous))}\n\n`);

if (command === "save") {
	const run = { date: ctx.date, sha: currentSha(), results };
	const next = appendRun(history, ctx, run);
	mkdirSync(dirname(HISTORY_FILE), { recursive: true });
	writeFileSync(HISTORY_FILE, `${JSON.stringify(next, null, 2)}\n`);
	process.stderr.write(
		`Saved (context ${id}, ${next.contexts[id].runs.length} runs stored).\n`,
	);
} else {
	process.stderr.write("Not saved. Run `pnpm bench:save` to record this run.\n");
}
