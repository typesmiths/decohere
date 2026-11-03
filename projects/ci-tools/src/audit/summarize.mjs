import { appendFileSync, readFileSync } from "node:fs";
import { formatLog, formatMarkdown, parseAudit } from "./format.mjs";

const auditFilePath = process.argv[2] ?? "npm-audit.json";

function writeSummary(text) {
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
	}
}

let data = null;
try {
	data = JSON.parse(readFileSync(auditFilePath, "utf8"));
} catch {
	const msg = `npm audit output could not be parsed (${auditFilePath}).\n`;
	process.stderr.write(msg);
	writeSummary(`## Security Audit\n\n- ${msg}`);
	process.exit(1);
}

const parsed = parseAudit(data);
process.stdout.write(formatLog(parsed));
writeSummary(formatMarkdown(parsed));
