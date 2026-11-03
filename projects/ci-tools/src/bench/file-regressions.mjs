#!/usr/bin/env node

/**
 * file-regressions.mjs — after nightly.mjs, open an issue for each benchmark that got slower
 * (regressions.json: head slower than base in every round on one runner), or update the open
 * one. Needs `gh` and GH_TOKEN with issues: write.
 *
 *   node projects/ci-tools/src/bench/file-regressions.mjs            # file issues
 *   node projects/ci-tools/src/bench/file-regressions.mjs --dry-run  # print them only
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { REGRESSION } from "./history.mjs";
import { issueBody, issueTitle } from "./regression-issue.mjs";

const REGRESSIONS_FILE = "projects/ci-tools/dist/ci/bench/regressions.json";
const dryRun = process.argv.includes("--dry-run");

function gh(args, input) {
	const result = spawnSync("gh", args, { encoding: "utf8", input, env: process.env });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `gh ${args.join(" ")} failed`);
	}
	return result.stdout;
}

const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const repository = process.env.GITHUB_REPOSITORY ?? "typesmiths/decohere";
const repoUrl = `${server}/${repository}`;
const runUrl = process.env.GITHUB_RUN_ID
	? `${repoUrl}/actions/runs/${process.env.GITHUB_RUN_ID}`
	: "(local run)";

const { base, head, context, regressions } = JSON.parse(
	readFileSync(REGRESSIONS_FILE, "utf8"),
);
if (base == null) {
	console.log("Nothing was compared tonight (no earlier nightly, or no new commit).");
	process.exit(0);
}
if (regressions.length === 0) {
	console.log(`No benchmark slower on ${head.slice(0, 7)} than on ${base.slice(0, 7)}.`);
	process.exit(0);
}

const machine = `${context.benchEnv}, ${context.cpu.model} × ${context.cpu.count}`;
const open = dryRun
	? []
	: JSON.parse(
			gh(["issue", "list", "--state", "open", "--limit", "200", "--json", "number,title"]),
		);

for (const regression of regressions) {
	const title = issueTitle(regression);
	const body = issueBody(regression, {
		repoUrl,
		runUrl,
		machine,
		threshold: REGRESSION.threshold,
		base,
		head,
	});
	if (dryRun) {
		console.log(`# ${title}\n\n${body}\n`);
		continue;
	}
	const existing = open.find((issue) => issue.title === title);
	if (existing != null) {
		gh(["issue", "edit", String(existing.number), "--body-file", "-"], body);
		console.log(`Updated #${existing.number}: ${title}`);
	} else {
		const url = gh(["issue", "create", "--title", title, "--body-file", "-"], body).trim();
		console.log(`Opened ${url}: ${title}`);
	}
}
