#!/usr/bin/env node
// When a run fails, put each failed step's reason on the run's summary page. GitHub only shows
// "Process completed with exit code 1" there, and the reason stays in the log. Standard library
// only: it has to work when the install or build is what failed.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

const NO_REASON = "No reason found in the log.";
const MAX_LINES = 40;
const MAX_REASON = 1000;
const EXIT_LINE = /^##\[error\]Process completed with exit code \d+\.?$/;
const NOISE = /^\s*(ELIFECYCLE|npm error (A complete log|code|path|command)|npm ERR!)/;
const STACK_FRAME = /^\s*(at |❯ )/;
const TEST_TOTALS = /^\s*(Test Files|Tests|Errors|Start at|Duration)\s/;
const NAMED_ERROR = /^\s*(\w*error\b\S*:|fatal:|FAIL\b)/i;
const FILE_POSITION = /^\s*\S+:\d+(:\d+)?:? /;

function cleanLines(log) {
	return log.split("\n").map((line) =>
		stripVTControlCharacters(line)
			.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, "")
			.replace(/\r$/, "")
			.replace(/^\ufeff/, ""),
	);
}

/** The failed step's reason and last lines, from a job's raw log. */
export function extractFailure(log) {
	const all = cleanLines(log);

	let end = all.findLastIndex((line) => EXIT_LINE.test(line));
	if (end === -1) end = all.findLastIndex((line) => line.startsWith("##[error]"));
	if (end === -1) return { reason: NO_REASON, lines: [] };

	const start = all.findLastIndex(
		(line, index) => index < end && line.startsWith("##[group]Run"),
	);
	const headerEnd = all.findIndex((line, index) => index > start && line === "##[endgroup]");
	const inclusive = EXIT_LINE.test(all[end]) ? end : end + 1;
	const body = all.slice(headerEnd === -1 ? start + 1 : headerEnd + 1, inclusive);

	const marked = body.find((line) => line.startsWith("##[error]"));
	const lines = body
		.filter((line) => !/^##\[(?!error\])/.test(line))
		.map((line) => line.replace(/^##\[error\]/, ""));

	return {
		reason: marked?.slice("##[error]".length) ?? pickReason(lines) ?? NO_REASON,
		lines: lines.slice(-MAX_LINES),
	};
}

/** The line most likely to say what went wrong. A step's last line is often a stack or totals. */
function pickReason(lines) {
	const candidates = lines.filter(
		(line) =>
			/[a-z]/i.test(line) &&
			!NOISE.test(line) &&
			!STACK_FRAME.test(line) &&
			!TEST_TOTALS.test(line),
	);
	const best =
		candidates.findLast((line) => NAMED_ERROR.test(line)) ??
		candidates.findLast((line) => FILE_POSITION.test(line)) ??
		candidates.at(-1);
	return best?.trim();
}

function encodeData(text) {
	return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function encodeProperty(text) {
	return encodeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/** A one-line annotation. Encoded, so text from a log can't act as a workflow command. */
export function errorCommand(title, reason) {
	return `::error title=${encodeProperty(title)}::${encodeData(reason.slice(0, MAX_REASON))}`;
}

export function formatSummary(failures) {
	const sections = failures.map(({ job, step, url, reason, lines }) => {
		const longestFence = Math.max(
			2,
			...lines.map((line) => /^`+/.exec(line)?.[0].length ?? 0),
		);
		const fence = "`".repeat(longestFence + 1);
		return [
			`### ${job} / ${step}`,
			"",
			reason,
			"",
			`[Full log](${url})`,
			"",
			fence,
			...lines,
			fence,
			"",
		].join("\n");
	});
	return ["## Why this run failed", "", ...sections].join("\n");
}

async function github(path, token, accept = "application/vnd.github+json") {
	const response = await fetch(`https://api.github.com/${path}`, {
		headers: { authorization: `Bearer ${token}`, accept },
	});
	if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${response.statusText}`);
	return response;
}

async function failedJobs(repo, runId, attempt, token) {
	const jobs = [];
	for (let page = 1; ; page++) {
		const response = await github(
			`repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`,
			token,
		);
		const batch = (await response.json()).jobs;
		jobs.push(...batch);
		if (batch.length < 100) break;
	}
	return jobs.filter((job) => job.conclusion === "failure");
}

async function main() {
	const {
		GITHUB_REPOSITORY: repo,
		GITHUB_RUN_ID: runId,
		GITHUB_RUN_ATTEMPT: attempt = "1",
		GH_TOKEN: token,
		GITHUB_STEP_SUMMARY: summaryPath,
	} = process.env;
	if (!repo || !runId || !token) {
		throw new Error("GITHUB_REPOSITORY, GITHUB_RUN_ID and GH_TOKEN are required");
	}

	const failures = [];
	for (const job of await failedJobs(repo, runId, attempt, token)) {
		const step = job.steps?.find((candidate) => candidate.conclusion === "failure")?.name;
		const response = await github(`repos/${repo}/actions/jobs/${job.id}/logs`, token);
		const { reason, lines } = extractFailure(await response.text());
		failures.push({
			job: job.name,
			step: step ?? "unknown step",
			url: job.html_url,
			reason,
			lines,
		});
	}

	for (const { job, step, reason } of failures) {
		console.log(errorCommand(`${job} / ${step}`, reason));
	}
	if (summaryPath && failures.length > 0) appendFileSync(summaryPath, formatSummary(failures));
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
