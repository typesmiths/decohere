#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WORKSPACE_ROOT = process.cwd();
const VITEST_BIN = join(WORKSPACE_ROOT, "node_modules/.bin/vitest");
const CONFIG = join(WORKSPACE_ROOT, "vitest.config.ts");
const TRACE_SPEC = "projects/cli/e2e/build.trace.e2e.spec.ts";
const TRACE_LOG_DIR = join(WORKSPACE_ROOT, ".decohere", "logs");

function truthy(value, defaultValue = false) {
	if (value == null) return defaultValue;
	return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function toFileTimestamp(date = new Date()) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function toTraceSample(line, parsed, durationMs) {
	return {
		time: parsed.time,
		name: parsed.name,
		message: parsed.msg,
		durationMs,
		line,
	};
}

function parseTraceSamples(rawOutput) {
	const samples = [];
	for (const rawLine of rawOutput.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line.startsWith("{")) continue;

		let parsed;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		if (typeof parsed?.name !== "string" || typeof parsed?.msg !== "string") continue;
		const match = parsed.msg.match(/^(.*):\s+([0-9]+(?:\.[0-9]+)?)ms$/);
		if (match == null) continue;

		const durationMs = Number(match[2]);
		if (!Number.isFinite(durationMs)) continue;

		samples.push({
			className: parsed.name,
			methodLabel: match[1],
			methodName: match[1].split("(")[0],
			durationMs,
			sample: toTraceSample(rawLine, parsed, durationMs),
		});
	}
	return samples;
}

function aggregateSamples(samples, keyBuilder) {
	const aggregates = new Map();
	for (const sample of samples) {
		const key = keyBuilder(sample);
		const current = aggregates.get(key) ?? {
			key,
			hitCount: 0,
			totalMs: 0,
			maxMs: 0,
		};
		current.hitCount += 1;
		current.totalMs += sample.durationMs;
		if (sample.durationMs > current.maxMs) current.maxMs = sample.durationMs;
		aggregates.set(key, current);
	}
	return [...aggregates.values()];
}

function analyzeTraceOutput(rawOutput) {
	const samples = parseTraceSamples(rawOutput);
	if (samples.length === 0) {
		process.stderr.write("\n⚠  No structured trace samples found to analyze.\n");
		return;
	}

	const byMethod = aggregateSamples(
		samples,
		(sample) => `${sample.className}.${sample.methodName}`,
	);
	const byClass = aggregateSamples(samples, (sample) => sample.className);
	const byHits = [...byMethod].sort((a, b) => b.hitCount - a.hitCount).slice(0, 10);
	const byTotal = [...byMethod].sort((a, b) => b.totalMs - a.totalMs).slice(0, 10);
	const byMax = [...byMethod].sort((a, b) => b.maxMs - a.maxMs).slice(0, 10);
	const byClassTotal = [...byClass].sort((a, b) => b.totalMs - a.totalMs).slice(0, 5);
	const totalTraceMs = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
	const hottest = [...samples].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);

	process.stderr.write(
		"\n┌─ Trace Analysis ─────────────────────────────────────────────────────────\n",
	);
	process.stderr.write(`│  Samples      : ${samples.length}\n`);
	process.stderr.write(`│  Unique funcs : ${byMethod.length}\n`);
	process.stderr.write(`│  Total traced : ${totalTraceMs.toFixed(2)}ms\n`);
	process.stderr.write(`│  Avg sample   : ${(totalTraceMs / samples.length).toFixed(3)}ms\n`);
	process.stderr.write(
		"└──────────────────────────────────────────────────────────────────────────\n",
	);

	const printTable = (title, rows, valueFormatter) => {
		process.stderr.write(`\n${title}\n`);
		for (const row of rows) {
			process.stderr.write(
				`  ${valueFormatter(row).padStart(10)}  ${row.key}  (hits=${row.hitCount}, max=${row.maxMs.toFixed(2)}ms)\n`,
			);
		}
	};

	printTable("Top Functions By Hit Count", byHits, (row) => String(row.hitCount));
	printTable("Top Functions By Total Time", byTotal, (row) => `${row.totalMs.toFixed(2)}ms`);
	printTable(
		"Top Functions By Worst Single Call",
		byMax,
		(row) => `${row.maxMs.toFixed(2)}ms`,
	);
	printTable(
		"Top Classes By Total Trace Time",
		byClassTotal,
		(row) => `${row.totalMs.toFixed(2)}ms`,
	);

	process.stderr.write("\nSlowest Individual Samples\n");
	for (const hot of hottest) {
		process.stderr.write(
			`  ${hot.durationMs.toFixed(2).padStart(10)}ms  ${hot.className}.${hot.methodLabel}\n`,
		);
	}
}

const shouldAnalyzeTrace = truthy(process.env.BENCH_ANALYZE_TRACE, true);
const shouldCollectTraceLog = truthy(process.env.BENCH_TRACE_LOG, true);
const traceLogPath = shouldCollectTraceLog
	? join(TRACE_LOG_DIR, `perf-trace-${toFileTimestamp()}.log`)
	: null;

if (traceLogPath != null) {
	mkdirSync(TRACE_LOG_DIR, { recursive: true });
}

const result = spawnSync(
	VITEST_BIN,
	["run", "--config", CONFIG, "--project", "e2e", TRACE_SPEC],
	{
		cwd: WORKSPACE_ROOT,
		stdio: "pipe",
		encoding: "utf8",
		maxBuffer: 1024 * 1024 * 200,
		env: {
			...process.env,
			NODE_OPTIONS: "",
			FORGE_TRACE: "1",
			FORGE_TRACE_STRUCTURED: "1",
			LOG_LEVEL: process.env.LOG_LEVEL ?? "trace",
		},
	},
);

const stdout = typeof result.stdout === "string" ? result.stdout : "";
const stderr = typeof result.stderr === "string" ? result.stderr : "";
if (stdout.length > 0) process.stdout.write(stdout);
if (stderr.length > 0) process.stderr.write(stderr);

const combined = `${stdout}${stderr.length > 0 ? `\n${stderr}` : ""}`;
if (traceLogPath != null) {
	writeFileSync(traceLogPath, combined);
	process.stderr.write(`\n✓  Trace log written: ${traceLogPath}\n`);
}

if (shouldAnalyzeTrace) {
	analyzeTraceOutput(combined);
}

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
