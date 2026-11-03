import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { upsertIssue } from "../lib/github-issue.mjs";

const WARN_DAYS = 14;
const MS_PER_DAY = 86_400_000;
const DEFAULT_REPO = "typesmiths/decohere";

/**
 * One profile per credential (repo secret + repo variable). Date math, GitHub issue
 * upsert, and fail-closed live below.
 *
 * @typedef {{
 *   id: string,
 *   secret: string,
 *   expiresVar: string,
 *   mint: string,
 *   failImpact: string,
 *   rejectedWhy: string,
 *   revokeUrl: string,
 * }} CredentialProfile
 */

/** @type {Record<string, CredentialProfile>} */
export const CREDENTIALS = {
	npm: {
		id: "npm",
		secret: "NODE_AUTH_TOKEN",
		expiresVar: "NODE_AUTH_TOKEN_EXPIRES_AT",
		mint: "Create an npm **read** token (granular/classic) at https://www.npmjs.com/settings/~/tokens — Publish PUTs are OIDC; this token is only for private `npm view` and create smoke.",
		failImpact:
			"Verify cannot see private packages, so skipIfPublished and create smoke are unsafe. Publish **fails closed** before OIDC/Docker. After you rotate, re-run the failed Publish jobs.",
		rejectedWhy: "`npm whoami` failed (expired, revoked, or missing `NODE_AUTH_TOKEN`).",
		revokeUrl: "https://www.npmjs.com/settings/~/tokens",
	},
};

export function utcDayMs(date) {
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** @param {string | undefined} raw */
export function parseExpiresAt(raw) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? "").trim());
	if (!match) {
		return null;
	}
	return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * @param {{ now?: number, expiresAtMs: number | null, warnDays?: number }} options
 * @returns {{ kind: "missing" | "ok" | "warn" | "expired", daysLeft: number | null }}
 */
export function assessTokenLifetime(options) {
	const { expiresAtMs, warnDays = WARN_DAYS } = options;
	if (expiresAtMs == null) {
		return { kind: "missing", daysLeft: null };
	}
	const today = utcDayMs(new Date(options.now ?? Date.now()));
	const daysLeft = Math.round((expiresAtMs - today) / MS_PER_DAY);
	if (daysLeft <= 0) {
		return { kind: "expired", daysLeft };
	}
	if (daysLeft <= warnDays) {
		return { kind: "warn", daysLeft };
	}
	return { kind: "ok", daysLeft };
}

/** @param {CredentialProfile} credential */
export function resolveRepo() {
	return process.env.GITHUB_REPOSITORY?.trim() || DEFAULT_REPO;
}

/** @param {string} id */
export function credentialProfile(id) {
	const credential = CREDENTIALS[id];
	if (!credential) {
		throw new Error(
			`Unknown NUDGE_CREDENTIAL=${id}. Expected one of: ${Object.keys(CREDENTIALS).join(", ")}`,
		);
	}
	return credential;
}

/** @param {CredentialProfile} credential */
export function issueTitle(credential, expiresYmd) {
	return `chore(security): rotate ${credential.secret} (expires ${expiresYmd})`;
}

/** @param {CredentialProfile} credential */
export function rotationCommands(credential, nextExpiresYmd, repo = resolveRepo()) {
	const next = nextExpiresYmd ?? "YYYY-MM-DD";
	return [
		credential.mint,
		"",
		"Then from a trusted machine (do not paste the token into Actions or this issue):",
		"",
		"```bash",
		`gh secret set ${credential.secret} --repo ${repo}`,
		`gh variable set ${credential.expiresVar} --repo ${repo} --body ${next}`,
		"```",
		"",
		`Revoke the old token: ${credential.revokeUrl}`,
		"Close this issue, then retry Publish:",
		"",
		"```bash",
		`gh run list --repo ${repo} --workflow Publish --limit 5`,
		`gh run rerun --failed <run-id> --repo ${repo}`,
		"```",
	].join("\n");
}

export function suggestedNextExpiry(fromMs, days = 90) {
	const start = utcDayMs(new Date(fromMs));
	const next = new Date(start + days * MS_PER_DAY);
	const y = next.getUTCFullYear();
	const m = String(next.getUTCMonth() + 1).padStart(2, "0");
	const d = String(next.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** @param {CredentialProfile} credential */
export function buildDescription(credential, options) {
	const { kind, expiresYmd, daysLeft, rejected, runUrl } = options;
	const next = suggestedNextExpiry(Date.now());
	const why = rejected
		? credential.rejectedWhy
		: kind === "expired"
			? `${credential.expiresVar} (${expiresYmd}) is today or in the past. Rotate ${credential.secret} and this date before Publish can continue.`
			: `${credential.secret} expires on ${expiresYmd} (${daysLeft} day(s) left). Rotate before that date so Publish does not fail closed.`;
	return [
		"## Summary",
		"",
		why,
		"",
		"## If this is not done in time",
		"",
		credential.failImpact,
		"",
		"## Commands",
		"",
		rotationCommands(credential, next),
		"",
		runUrl ? `- Workflow run: ${runUrl}` : null,
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

/** @param {CredentialProfile} credential */
export function upsertRotationIssue(credential, options, upsert = upsertIssue) {
	const { expiresYmd, kind, daysLeft, rejected } = options;
	return upsert({
		title: issueTitle(credential, expiresYmd ?? "unknown"),
		body: buildDescription(credential, {
			kind,
			expiresYmd,
			daysLeft,
			rejected,
			runUrl: runUrl(),
		}),
	});
}

export async function runNudge(env = process.env, upsert = upsertIssue) {
	const credential = credentialProfile(String(env.NUDGE_CREDENTIAL ?? "").trim());
	const rejected = env.NUDGE_REJECTED === "1";
	const expiresYmd = String(env[credential.expiresVar] ?? "").trim();
	const expiresAtMs = parseExpiresAt(expiresYmd);
	const assessment = assessTokenLifetime({ expiresAtMs });
	const repo = env.GITHUB_REPOSITORY?.trim() || DEFAULT_REPO;

	if (assessment.kind === "missing" && !rejected) {
		process.stderr.write(
			`repository variable ${credential.expiresVar}=YYYY-MM-DD is required\n` +
				`  gh variable set ${credential.expiresVar} --repo ${repo} --body YYYY-MM-DD\n`,
		);
		return 1;
	}

	if (rejected || assessment.kind === "warn" || assessment.kind === "expired") {
		const result = upsertRotationIssue(
			credential,
			{
				expiresYmd: expiresYmd || "unknown",
				kind: assessment.kind,
				daysLeft: assessment.daysLeft,
				rejected,
			},
			upsert,
		);
		process.stdout.write(
			`${result.created ? "Opened" : "Updated"} issue #${result.number} ${result.url}\n`,
		);
	}

	if (rejected || assessment.kind === "expired" || assessment.kind === "missing") {
		if (assessment.kind === "expired") {
			process.stderr.write(
				`${credential.secret} calendar expiry ${expiresYmd} has been reached — refusing to continue\n`,
			);
		}
		return 1;
	}
	return 0;
}

const isCli =
	process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
	process.exit(await runNudge());
}
