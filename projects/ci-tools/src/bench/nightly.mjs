#!/usr/bin/env node

/**
 * nightly.mjs — the nightly benchmark run. Benchmarks tonight's commit (head) and the
 * commit the previous nightly measured (base) on this runner, alternating head, base, head,
 * base, so the comparison never mixes CPU models. Then:
 *
 * - appends head's first round to the history (projects/ci-tools/dist/ci/bench/), for the charts;
 * - writes regressions.json next to it: the benchmarks slower on head in every round
 *   (history.mjs `compareRounds`), which file-regressions.mjs turns into issues.
 *
 * Base runs from its own checkout (a git worktree) with its own dependencies and its own
 * bench.mjs, so each commit is measured with its own code. With no earlier nightly, or no new
 * commit since, it benchmarks head once and compares nothing.
 *
 *   node projects/ci-tools/src/bench/nightly.mjs   (from the repo root; needs the full git history)
 */

import { execFileSync } from "node:child_process";
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
	compareRounds,
	getContext,
	latestRun,
	normalize,
	REGRESSION,
} from "./history.mjs";

const ROOT = process.cwd();
const DIST = join(ROOT, "projects/ci-tools/dist/ci/bench");
const HISTORY_FILE = join(DIST, "bench-history.json");
const REGRESSIONS_FILE = join(DIST, "regressions.json");
const BENCH = "projects/ci-tools/src/bench/bench.mjs";

function run(command, args, cwd, env = {}) {
	execFileSync(command, args, {
		cwd,
		stdio: ["ignore", "inherit", "inherit"],
		env: { ...process.env, ...env },
	});
}

function git(...args) {
	return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** Runs one round of every suite in `cwd` and returns its results, saved to its own history. */
function benchRound(cwd, label, round, workDir) {
	process.stderr.write(`\n══ ${label}, round ${round + 1}\n`);
	const historyFile = join(workDir, `${label}-${round}.json`);
	run("node", [BENCH, "save"], cwd, { BENCH_HISTORY_FILE: historyFile });
	// Base's bench.mjs may predate BENCH_HISTORY_FILE and save to its checkout's default path.
	const file = existsSync(historyFile)
		? historyFile
		: join(cwd, "projects/ci-tools/dist/ci/bench/bench-history.json");
	const saved = normalize(JSON.parse(readFileSync(file, "utf8")));
	const newest = latestRun(saved);
	if (newest == null) throw new Error(`${label} round ${round + 1} saved no run`);
	return newest.results;
}

const history = normalize(
	existsSync(HISTORY_FILE) ? JSON.parse(readFileSync(HISTORY_FILE, "utf8")) : null,
);
const head = git("rev-parse", "HEAD");
const base = latestRun(history)?.sha ?? null;
const workDir = mkdtempSync(join(os.tmpdir(), "decohere-nightly-"));

try {
	const headRounds = [];
	const baseRounds = [];
	const compareWith = base != null && base !== head ? base : null;
	if (compareWith == null) {
		process.stderr.write(
			base == null
				? "No earlier nightly run: benchmarking head only.\n"
				: `No new commit since the last nightly (${head.slice(0, 7)}): benchmarking head only.\n`,
		);
		headRounds.push(benchRound(ROOT, "head", 0, workDir));
	} else {
		const baseDir = join(workDir, "base");
		run("git", ["worktree", "add", "--detach", baseDir, compareWith], ROOT);
		run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], baseDir);
		for (let round = 0; round < REGRESSION.rounds; round++) {
			headRounds.push(benchRound(ROOT, "head", round, workDir));
			baseRounds.push(benchRound(baseDir, "base", round, workDir));
		}
	}

	const ctx = getContext(os, process.env, process.version);
	const next = appendRun(history, ctx, { date: ctx.date, sha: head, results: headRounds[0] });
	mkdirSync(dirname(HISTORY_FILE), { recursive: true });
	writeFileSync(HISTORY_FILE, `${JSON.stringify(next, null, 2)}\n`);

	const regressions = compareWith == null ? [] : compareRounds(headRounds, baseRounds);
	writeFileSync(
		REGRESSIONS_FILE,
		`${JSON.stringify({ base: compareWith, head, context: ctx, regressions }, null, 2)}\n`,
	);
	process.stderr.write(
		`\nSaved head's run. ${compareWith == null ? "Nothing compared." : `Compared with ${compareWith.slice(0, 7)}: ${regressions.length} benchmark(s) slower in every round.`}\n`,
	);
} finally {
	if (existsSync(join(workDir, "base"))) {
		run("git", ["worktree", "remove", "--force", join(workDir, "base")], ROOT);
	}
	rmSync(workDir, { recursive: true, force: true });
}
