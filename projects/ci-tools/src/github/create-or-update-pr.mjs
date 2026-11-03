import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

function getArg(name, fallback) {
	const equals = process.argv.find((arg) => arg.startsWith(`--${name}=`));
	if (equals) return equals.slice(name.length + 3);
	const index = process.argv.indexOf(`--${name}`);
	if (index >= 0) return process.argv[index + 1];
	return fallback;
}

function hasFlag(name) {
	return process.argv.includes(`--${name}`);
}

function run(command) {
	return execSync(command, { encoding: "utf8" }).trim();
}

function parseRepoFromRemoteUrl(url) {
	const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
	if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
	const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
	if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
	throw new Error(`Unable to parse GitHub owner/repo from remote URL: ${url}`);
}

async function request(apiBaseUrl, token, method, path, body) {
	const response = await fetch(`${apiBaseUrl}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"Content-Type": "application/json",
		},
		body: body == null ? undefined : JSON.stringify(body),
	});
	if (!response.ok) {
		const message = await response.text();
		throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${message}`);
	}
	return response.status === 204 ? undefined : response.json();
}

if (hasFlag("help")) {
	console.log(`Usage: node create-or-update-pr.mjs [options]

Required:
  --title <title>                PR title
  --body <markdown>              PR body markdown
    or
  --body-file <path>             Read PR body markdown from file

Optional:
  --base <branch>                Base branch (default: main)
  --head <branch>                Head branch (default: current git branch)
  --draft                        Create as draft
  --labels <a,b,c>               Apply labels
  --reviewers <u1,u2>            Request reviewers
  --dry-run                      Print intended operation without calling API
  --help                         Show this help

Auth: Set GITHUB_TOKEN or GH_TOKEN
`);
	process.exit(0);
}

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (token == null || token.length === 0) throw new Error("Missing GITHUB_TOKEN or GH_TOKEN");

const apiBaseUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
const base = getArg("base", "main");
const head = getArg("head", run("git rev-parse --abbrev-ref HEAD"));
const title = getArg("title");
const bodyFile = getArg("body-file");
const body = getArg("body", bodyFile ? readFileSync(bodyFile, "utf8") : undefined);
const draft = hasFlag("draft");
const dryRun = hasFlag("dry-run");
const labels = (getArg("labels") ?? "")
	.split(",")
	.map((v) => v.trim())
	.filter(Boolean);
const reviewers = (getArg("reviewers") ?? "")
	.split(",")
	.map((v) => v.trim())
	.filter(Boolean);

if (!title) throw new Error("Missing required argument: --title");
if (!body) throw new Error("Missing required argument: --body or --body-file");

const remoteUrl = run("git config --get remote.origin.url");
const parsedRepo = parseRepoFromRemoteUrl(remoteUrl);
const owner = getArg("owner", parsedRepo.owner);
const repo = getArg("repo", parsedRepo.repo);

const findPath = `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`;

if (dryRun) {
	console.log(
		JSON.stringify({ owner, repo, base, head, title, draft, labels, reviewers }, null, 2),
	);
	process.exit(0);
}

const existing = await request(apiBaseUrl, token, "GET", findPath);
const pr = existing[0]
	? await request(
			apiBaseUrl,
			token,
			"PATCH",
			`/repos/${owner}/${repo}/pulls/${existing[0].number}`,
			{ title, body, base },
		)
	: await request(apiBaseUrl, token, "POST", `/repos/${owner}/${repo}/pulls`, {
			title,
			body,
			base,
			head,
			draft,
		});

if (labels.length > 0) {
	await request(
		apiBaseUrl,
		token,
		"POST",
		`/repos/${owner}/${repo}/issues/${pr.number}/labels`,
		{ labels },
	);
}

if (reviewers.length > 0) {
	await request(
		apiBaseUrl,
		token,
		"POST",
		`/repos/${owner}/${repo}/pulls/${pr.number}/requested_reviewers`,
		{ reviewers },
	);
}

console.log(`${existing[0] ? "Updated" : "Created"} PR #${pr.number}: ${pr.html_url}`);
