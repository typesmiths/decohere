import { existsSync, readFileSync } from "node:fs";
import { upsertIssue } from "../lib/github-issue.mjs";
import { formatMarkdown, parseAudit } from "./format.mjs";

const auditFilePath = process.argv[2] ?? "npm-audit.json";
const ISSUE_TITLE = "security(ci): npm audit vulnerabilities detected";

function runUrl() {
	if (
		process.env.GITHUB_SERVER_URL &&
		process.env.GITHUB_REPOSITORY &&
		process.env.GITHUB_RUN_ID
	) {
		return `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
	}
	return "(run URL unavailable)";
}

if (!existsSync(auditFilePath)) {
	console.log(`No audit file found at ${auditFilePath}; skipping issue update.`);
	process.exit(0);
}

const parsed = parseAudit(JSON.parse(readFileSync(auditFilePath, "utf8")));
if (parsed.total === 0) {
	console.log("No vulnerabilities found; skipping issue create/update.");
	process.exit(0);
}

const sha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 12) : "unknown";
const body = [
	formatMarkdown(parsed).trim(),
	"",
	`- Commit: \`${sha}\``,
	`- Workflow run: ${runUrl()}`,
	"",
	"This issue is managed by CI: main-branch runs and the nightly audit update it in place while vulnerabilities remain.",
].join("\n");

const result = upsertIssue({ title: ISSUE_TITLE, body });
console.log(`${result.created ? "Opened" : "Updated"} issue #${result.number} ${result.url}`);
