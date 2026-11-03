/**
 * One GitHub issue per subject, found again by its exact title and updated in place: CI files
 * a reminder once and keeps it current instead of opening a new issue every run. Needs `gh` and
 * GH_TOKEN (or GITHUB_TOKEN) with issues: write.
 */

import { spawnSync } from "node:child_process";

/**
 * @param {string[]} args
 * @param {string} [input]
 */
export function gh(args, input) {
	const result = spawnSync("gh", args, { encoding: "utf8", input, env: process.env });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `gh ${args.join(" ")} failed`);
	}
	return result.stdout;
}

/**
 * The issue titled exactly `title`, preferring an open one over a closed one.
 *
 * @param {{ number: number, title: string, state: string, url: string }[]} issues
 * @param {string} title
 */
export function pickIssue(issues, title) {
	const matches = issues.filter((issue) => issue.title === title);
	return matches.find((issue) => issue.state === "OPEN") ?? matches[0] ?? null;
}

/**
 * @param {{ title: string, body: string, assignees?: string[], repo?: string }} options
 * @param {typeof gh} [run]
 * @returns {{ number: number, url: string, created: boolean }}
 */
export function upsertIssue(options, run = gh) {
	const { title, body, assignees = [] } = options;
	const repo = options.repo ? ["--repo", options.repo] : [];
	const issues = JSON.parse(
		run([
			"issue",
			"list",
			...repo,
			"--state",
			"all",
			"--limit",
			"200",
			"--search",
			// Quoted: GitHub's search can't match a title like `security(ci): …` unquoted.
			// The exact-title match in pickIssue still decides.
			`"${title.replaceAll('"', "")}" in:title`,
			"--json",
			"number,title,state,url",
		]),
	);
	const assign = assignees.flatMap((login) => ["--add-assignee", login]);
	const existing = pickIssue(issues, title);
	if (existing != null) {
		if (existing.state !== "OPEN") {
			run(["issue", "reopen", String(existing.number), ...repo]);
		}
		run(
			["issue", "edit", String(existing.number), ...repo, "--body-file", "-", ...assign],
			body,
		);
		return { number: existing.number, url: existing.url, created: false };
	}
	const url = run(
		["issue", "create", ...repo, "--title", title, "--body-file", "-", ...assign],
		body,
	).trim();
	const number = Number(url.split("/").pop());
	return { number, url, created: true };
}
