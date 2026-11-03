import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { upsertIssue } from "../lib/github-issue.mjs";
import { needsPrereleaseTag, TRUSTED_PUBLISHER } from "./npm-bootstrap.mjs";
import { listPublishablePackages } from "./publish-verify.mjs";

export { needsPrereleaseTag } from "./npm-bootstrap.mjs";

const GITHUB_API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const ISSUE_TITLE = "deploy(publish): OIDC bootstrap unpublished packages";
const BOOTSTRAP_ENV = "npm-oidc-bootstrap";
const DEFAULT_REPO = "typesmiths/decohere";

export function issueTitle() {
	return ISSUE_TITLE;
}

/** @param {string | undefined} raw */
export function parseUnpublished(raw) {
	return String(raw ?? "")
		.split(/\s+/)
		.map((name) => name.trim())
		.filter(Boolean);
}

/**
 * @param {{ name: string, dir: string, version?: string }[]} packages
 * @param {string} [channel]
 */
export function firstPublishCommands(packages, channel = "dev") {
	if (packages.length === 0) {
		return [`npm publish ./<package-dir> --tag ${channel}`];
	}
	return packages.map((pkg) => {
		const tag = needsPrereleaseTag(pkg.version) ? ` --tag ${channel}` : "";
		return `npm publish ./projects/${pkg.dir} --access public${tag}`;
	});
}

/**
 * @param {unknown} environment
 * @returns {string[]}
 */
export function extractGitHubReviewerLogins(environment) {
	const rules =
		environment && typeof environment === "object" ? environment.protection_rules : null;
	if (!Array.isArray(rules)) {
		return [];
	}
	const logins = [];
	for (const rule of rules) {
		const reviewers = rule?.reviewers;
		if (!Array.isArray(reviewers)) {
			continue;
		}
		for (const entry of reviewers) {
			const login = entry?.reviewer?.login;
			if (typeof login === "string" && login.length > 0 && entry?.type !== "Team") {
				logins.push(login);
			}
		}
	}
	return [...new Set(logins)];
}

/**
 * @param {{
 *   unpublished: string[],
 *   packages: { name: string, dir: string, version?: string }[],
 *   repo?: string,
 *   runUrl?: string,
 *   channel?: string,
 * }} options
 */
export function buildDescription(options) {
	const repo = options.repo || DEFAULT_REPO;
	const names = options.unpublished;
	const channel = options.channel || "dev";
	const packages = options.packages.filter((pkg) => names.includes(pkg.name));
	const [owner, repoName] = repo.split("/");
	return [
		"## Summary",
		"",
		"These package names are not on npm yet, so OIDC `npm publish` cannot run until each name exists and has a Trusted Publisher:",
		"",
		...names.map((name) => `- \`${name}\``),
		"",
		"## What to do",
		"",
		"From a trusted machine, `npm login` to the org, then from the **repo root** (`--otp` is optional: npm asks for a code, or the browser login, whenever it needs one):",
		"",
		"```bash",
		`pnpm npm:bootstrap --otp <code> ${names.join(" ")}`,
		"```",
		"",
		"That does steps 1 and 2 below, skipping what is already done. To do them by hand instead:",
		"",
		"1. First-publish each name **public** (`--access public`: scoped names default to restricted). From a trusted machine, `npm login` to the org, then from the **repo root**. Use `./` so npm does not treat the path as a GitHub `owner/repo`. `--tag` is required for prerelease versions (`x.y.z-dev.N`). Missing `bin`/`es6` warnings are OK for this name-only bootstrap; CI `forge publish` ships the built tarball later:",
		"",
		"```bash",
		...firstPublishCommands(packages, channel),
		"```",
		"",
		"2. npm → package settings → Trusted Publisher → GitHub Actions:",
		"",
		`- Organization: \`${owner ?? "typesmiths"}\``,
		`- Repository: \`${repoName ?? "decohere"}\``,
		`- Workflow filename: \`${TRUSTED_PUBLISHER.file}\``,
		`- Environment: \`${TRUSTED_PUBLISHER.environment}\``,
		"- Allowed action: `npm publish` (not staged-only)",
		"",
		"3. Approve the waiting **npm-oidc-bootstrap** deployment on this Publish run. The job re-checks that the names exist, then npm + Docker + tag continue. If reviewers were not configured and the job already failed:",
		"",
		"```bash",
		`gh run list --repo ${repo} --workflow Publish --limit 5`,
		`gh run rerun --failed <run-id> --repo ${repo}`,
		"```",
		"",
		options.runUrl ? `- Workflow run: ${options.runUrl}` : null,
	]
		.filter((line) => line != null)
		.join("\n");
}

function runUrl() {
	if (
		process.env.GITHUB_SERVER_URL &&
		process.env.GITHUB_REPOSITORY &&
		process.env.GITHUB_RUN_ID
	) {
		return `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
	}
	return "";
}

/**
 * @param {{ fetch?: typeof fetch, token?: string, repo?: string, environment?: string }} options
 */
export async function githubEnvironmentReviewerLogins(options = {}) {
	const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
	const repo = options.repo ?? process.env.GITHUB_REPOSITORY ?? "";
	const environment = options.environment ?? BOOTSTRAP_ENV;
	const fetchFn = options.fetch ?? fetch;
	if (!token || !repo) {
		return [];
	}
	const response = await fetchFn(
		`${GITHUB_API}/repos/${repo}/environments/${encodeURIComponent(environment)}`,
		{
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		},
	);
	if (!response.ok) {
		process.stderr.write(
			`Could not list ${environment} reviewers (${response.status}); the issue will have no assignees\n`,
		);
		return [];
	}
	return extractGitHubReviewerLogins(await response.json());
}

export async function runNudge(env = process.env, io = {}) {
	const unpublished = parseUnpublished(env.UNPUBLISHED);
	if (unpublished.length === 0) {
		process.stdout.write("No unpublished package names; skipping OIDC bootstrap issue\n");
		return 0;
	}

	const root = io.root ?? process.cwd();
	const packages = (io.listPackages ?? listPublishablePackages)(root);
	const assignees = await (io.githubReviewers ?? githubEnvironmentReviewerLogins)({
		token: env.GITHUB_TOKEN ?? env.GH_TOKEN,
		repo: env.GITHUB_REPOSITORY,
	});
	const repo = env.GITHUB_REPOSITORY || DEFAULT_REPO;

	const result = (io.upsert ?? upsertIssue)({
		title: issueTitle(),
		body: buildDescription({
			unpublished,
			packages,
			repo,
			runUrl: io.runUrl ?? runUrl(),
			channel: env.PUBLISH_CHANNEL || env.CHANNEL || "dev",
		}),
		assignees,
	});
	process.stdout.write(
		`${result.created ? "Opened" : "Updated"} issue #${result.number} ${result.url}\n`,
	);
	if (assignees.length > 0) {
		process.stdout.write(`Assigned ${assignees.join(", ")}\n`);
	} else {
		process.stdout.write(
			`No assignees (add required reviewers on the ${BOOTSTRAP_ENV} environment)\n`,
		);
	}
	if (env.GITHUB_OUTPUT) {
		const { appendFileSync } = await import("node:fs");
		appendFileSync(env.GITHUB_OUTPUT, `issue_url=${result.url}\n`);
	}
	return 0;
}

const isCli =
	process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
	process.exit(await runNudge());
}
