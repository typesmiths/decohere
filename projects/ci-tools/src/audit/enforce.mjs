import { readFileSync } from "node:fs";
import { formatLog, highCritical, parseAudit } from "./format.mjs";

const auditFilePath = process.argv[2] ?? "npm-audit.json";

let data = null;
try {
	data = JSON.parse(readFileSync(auditFilePath, "utf8"));
} catch {
	console.error(`Security gate failed: could not parse ${auditFilePath}.`);
	process.exit(1);
}

const parsed = parseAudit(data);
const blocking = highCritical(parsed);

if (blocking.length > 0) {
	console.error(
		`Security gate failed: high=${parsed.high}, critical=${parsed.critical}\n${formatLog({ ...parsed, advisories: blocking })}`,
	);
	process.exit(1);
}

console.log("Security gate passed: no high/critical vulnerabilities found.");
