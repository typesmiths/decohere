/**
 * Benchmark history: the results of each `pnpm bench` run, kept per machine so runs are only
 * compared like for like. Pure functions over plain data; bench.mjs does the I/O.
 *
 * Shape (version 2):
 *   { version: 2, contexts: { [contextId]: { context, runs: [{ date, sha, results }] } } }
 * newest run first. A result is { id, label, unit, median, p90?, min, max, samples, files? }.
 */

import crypto from "node:crypto";

export const HISTORY_VERSION = 2;
/** Nightly runs: a month per machine, enough for a trend and a regression baseline. */
export const MAX_RUNS = 30;
/** Printed by each suite before its JSON array of results (projects/flux/bench/harness.ts). */
export const RESULT_PREFIX = "BENCH_RESULT ";

/** The machine a run happened on. Runs are compared only within one context. */
export function getContext(os, env, nodeVersion, date = new Date()) {
	const cpus = os.cpus();
	const nodeMajor = nodeVersion.match(/^v(\d+)/)?.[1] ?? "?";
	const rawEnv = env.BENCH_ENV ?? null;
	return {
		benchEnv: rawEnv ? `${rawEnv}-node${nodeMajor}` : "(local)",
		date: date.toISOString(),
		os: { platform: os.platform(), arch: os.arch() },
		cpu: { model: cpus[0]?.model?.trim() ?? "unknown", count: cpus.length },
		memoryGb: Number.parseFloat((os.totalmem() / 1024 ** 3).toFixed(1)),
		node: nodeVersion,
	};
}

/** 16-char SHA-256 prefix of platform|arch|cpu|cores|memGB|node. */
export function contextId(ctx) {
	const key = [
		ctx.os.platform,
		ctx.os.arch,
		ctx.cpu.model,
		ctx.cpu.count,
		ctx.memoryGb,
		ctx.node,
	].join("|");
	return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** The results a suite printed, from its whole output. Throws if it printed none. */
export function parseResults(output, suite) {
	const line = output
		.split(/\r?\n/)
		.reverse()
		.find((candidate) => candidate.startsWith(RESULT_PREFIX));
	if (line == null)
		throw new Error(`suite "${suite}" printed no ${RESULT_PREFIX.trim()} line`);
	return JSON.parse(line.slice(RESULT_PREFIX.length));
}

const FORGE_BENCHMARKS = [
	["forge build es6 + types", "forge.build.local"],
	["forge build es6 only", "forge.build.debug"],
	["forge build types only", "forge.build.types-only"],
];

/**
 * Results from `vitest bench --outputJson` for the forge build benchmark. Its names end in a
 * file count, so they are mapped to stable ids; vitest reports no p90, so it is left out.
 */
export function fromVitest(vitestOutput) {
	return vitestOutput.files
		.flatMap((file) => file.groups)
		.flatMap((group) => group.benchmarks)
		.map((benchmark) => {
			const id = FORGE_BENCHMARKS.find(([prefix]) => benchmark.name.startsWith(prefix))?.[1];
			if (id == null) throw new Error(`unknown forge benchmark "${benchmark.name}"`);
			const files = Number(benchmark.name.match(/\((\d+) files\)/)?.[1]);
			return {
				id,
				label: benchmark.name.replace(/\s*\(\d+ files\)$/, ""),
				unit: "ms",
				median: benchmark.median ?? benchmark.mean,
				min: benchmark.min,
				max: benchmark.max,
				samples: benchmark.sampleCount,
				...(Number.isFinite(files) ? { files } : {}),
			};
		});
}

/** Throws when a result has no usable numbers: a suite that errored mid-run, not a slow one. */
export function assertValid(results) {
	const invalid = results.filter(
		(result) => !Number.isFinite(result.median) || !(result.samples > 0),
	);
	if (invalid.length > 0) {
		throw new Error(
			`${invalid.length} benchmark(s) have no valid samples: ${invalid.map((r) => r.id).join(", ")}`,
		);
	}
}

/**
 * Reads a stored history. Version 1 (forge build only, raw vitest output) is converted so its
 * trend carries on; anything unrecognised starts empty rather than mixing formats.
 */
export function normalize(raw) {
	if (raw?.version === HISTORY_VERSION && raw.contexts != null) return raw;
	const contexts = {};
	for (const [id, entry] of Object.entries(raw?.runs ?? {})) {
		const runs = (entry.runs ?? [])
			.filter((run) => run.vitestOutput != null)
			.map((run) => ({ date: run.date, sha: null, results: fromVitest(run.vitestOutput) }));
		if (runs.length > 0) contexts[id] = { context: entry.context, runs };
	}
	return { version: HISTORY_VERSION, contexts };
}

/** The previous run for this context, if any: what a new run is compared against. */
export function previousRun(history, id) {
	return history.contexts[id]?.runs[0];
}

/** Machine types with no run for this long are dropped: CI runner types come and go. */
export const STALE_AFTER_DAYS = 30;

/** The history without machine types whose newest run is older than `days` before `now`. */
export function pruneStale(history, now, days = STALE_AFTER_DAYS) {
	const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
	const contexts = Object.fromEntries(
		Object.entries(history.contexts).filter(
			([, entry]) => entry.runs[0] != null && new Date(entry.runs[0].date).getTime() >= cutoff,
		),
	);
	return { version: HISTORY_VERSION, contexts };
}

/**
 * A new history with `run` first in its context, trimmed to `max` runs, and machine types
 * without a recent run dropped. Does not mutate.
 */
export function appendRun(history, ctx, run, max = MAX_RUNS) {
	const id = contextId(ctx);
	const runs = [run, ...(history.contexts[id]?.runs ?? [])].slice(0, max);
	return pruneStale(
		{
			version: HISTORY_VERSION,
			contexts: { ...history.contexts, [id]: { context: ctx, runs } },
		},
		new Date(run.date),
	);
}

/** The newest run on any machine: the commit the previous nightly measured. */
export function latestRun(history) {
	return Object.values(history.contexts)
		.map((entry) => entry.runs[0])
		.filter((run) => run != null)
		.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
}

/** One row per current result, with the change in median against the previous run. */
export function compare(results, previous) {
	const before = new Map((previous?.results ?? []).map((result) => [result.id, result]));
	return results.map((result) => {
		const old = before.get(result.id);
		if (old == null) return { id: result.id, current: result.median };
		const delta = result.median - old.median;
		return {
			id: result.id,
			current: result.median,
			previous: old.median,
			delta,
			percent: old.median === 0 ? 0 : (delta / old.median) * 100,
		};
	});
}

/** The comparison as an aligned text table. */
export function formatComparison(rows) {
	const ms = (value) => (value == null ? "n/a" : `${value.toFixed(1)} ms`);
	const signed = (value, suffix) =>
		value == null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
	const table = [
		["Benchmark", "Median", "Previous", "Delta", "%"],
		...rows.map((row) => [
			row.id,
			ms(row.current),
			ms(row.previous),
			signed(row.delta, " ms"),
			signed(row.percent, "%"),
		]),
	];
	const widths = table[0].map((_, column) =>
		Math.max(...table.map((row) => row[column].length)),
	);
	const line = (row) =>
		row
			.map((cell, column) =>
				(column === 0 ? cell.padEnd : cell.padStart).call(cell, widths[column]),
			)
			.join(" | ");
	return [
		line(table[0]),
		widths.map((w) => "-".repeat(w)).join("-+-"),
		...table.slice(1).map(line),
	].join("\n");
}

/**
 * When a benchmark counts as slower: the nightly job benchmarks tonight's commit (head)
 * and the one the previous nightly measured (base) on the same runner, alternating head, base,
 * head, base. A benchmark regressed when head's median beats base's by more than `threshold`
 * in every round, so one noisy round files nothing.
 */
export const REGRESSION = { threshold: 0.2, rounds: 2 };

/**
 * The benchmarks slower on head than on base. `headRounds` and `baseRounds` are lists of result
 * lists, one per round, run alternately on one machine. Benchmarks either side lacks are skipped.
 */
export function compareRounds(headRounds, baseRounds, options = REGRESSION) {
	const rounds = Math.min(headRounds.length, baseRounds.length);
	if (rounds < options.rounds) return [];
	const medianIn = (results, id) => results.find((result) => result.id === id)?.median;
	const regressions = [];
	for (const head of headRounds[0]) {
		const pairs = Array.from({ length: rounds }, (_, round) => ({
			head: medianIn(headRounds[round], head.id),
			base: medianIn(baseRounds[round], head.id),
		}));
		const comparable = pairs.every(
			(pair) => Number.isFinite(pair.head) && Number.isFinite(pair.base) && pair.base > 0,
		);
		if (!comparable) continue;
		const slower = pairs.every((pair) => pair.head > pair.base * (1 + options.threshold));
		if (!slower) continue;
		const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
		const headMs = mean(pairs.map((pair) => pair.head));
		const baseMs = mean(pairs.map((pair) => pair.base));
		regressions.push({
			id: head.id,
			label: head.label,
			base: baseMs,
			head: headMs,
			percent: (headMs / baseMs - 1) * 100,
			rounds: pairs,
		});
	}
	return regressions;
}
