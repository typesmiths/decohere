/**
 * Shared npm/pnpm audit JSON helpers.
 *
 * Supports pnpm's classic `{ advisories }` report and npm audit v2
 * `{ auditReportVersion: 2, vulnerabilities }` (pnpm 9+/10).
 */

const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"];

function ghsaFromUrl(url) {
	return typeof url === "string" ? (url.match(/GHSA-[a-z0-9-]+/i)?.[0] ?? "") : "";
}

function fromClassicAdvisories(data) {
	return Object.values(data?.advisories ?? {}).map((raw) => {
		const paths = (raw.findings ?? []).flatMap((f) => f.paths ?? []);
		const url = raw.url ?? "";
		return {
			id: raw.id,
			module: raw.module_name ?? "(unknown)",
			severity: String(raw.severity ?? "info").toLowerCase(),
			title: raw.title ?? "",
			url,
			vulnerable: raw.vulnerable_versions ?? "",
			patched: raw.patched_versions ?? "",
			cves: raw.cves ?? [],
			ghsa: ghsaFromUrl(url),
			paths: paths.slice(0, 3),
		};
	});
}

function fromNpmV2(data) {
	const byKey = new Map();
	for (const vuln of Object.values(data?.vulnerabilities ?? {})) {
		const vias = Array.isArray(vuln.via) ? vuln.via : [];
		for (const via of vias) {
			if (via == null || typeof via !== "object") continue;
			const url = via.url ?? "";
			const key = url || `${via.name ?? vuln.name}:${via.title ?? ""}`;
			const existing = byKey.get(key);
			const node = Array.isArray(vuln.nodes) ? vuln.nodes[0] : undefined;
			if (existing) {
				if (node && existing.paths.length < 3 && !existing.paths.includes(node)) {
					existing.paths.push(node);
				}
				continue;
			}
			byKey.set(key, {
				id: via.source,
				module: via.name ?? vuln.name ?? "(unknown)",
				severity: String(via.severity ?? vuln.severity ?? "info").toLowerCase(),
				title: via.title ?? "",
				url,
				vulnerable: via.range ?? vuln.range ?? "",
				patched: "",
				cves: [],
				ghsa: ghsaFromUrl(url),
				paths: node ? [node] : [],
			});
		}
	}
	return [...byKey.values()];
}

export function parseAudit(data) {
	const counts = data?.metadata?.vulnerabilities ?? {};
	const info = counts.info ?? 0;
	const low = counts.low ?? 0;
	const moderate = counts.moderate ?? 0;
	const high = counts.high ?? 0;
	const critical = counts.critical ?? 0;
	const total = counts.total ?? info + low + moderate + high + critical;

	const classic = data?.advisories != null && Object.keys(data.advisories).length > 0;
	const advisories = classic ? fromClassicAdvisories(data) : fromNpmV2(data);

	advisories.sort((a, b) => {
		const d = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
		if (d !== 0) return d;
		return String(a.module).localeCompare(String(b.module));
	});

	return { total, critical, high, moderate, low, info, advisories };
}

export function formatLog(parsed) {
	const lines = [
		`npm audit: total=${parsed.total} critical=${parsed.critical} high=${parsed.high} moderate=${parsed.moderate} low=${parsed.low} info=${parsed.info}`,
	];
	for (const a of parsed.advisories) {
		const id = a.ghsa || a.cves[0] || a.id;
		lines.push(
			`  [${a.severity}] ${a.module} ${id}: ${a.title} (vulnerable ${a.vulnerable}; patched ${a.patched})`,
		);
		if (a.url) lines.push(`    ${a.url}`);
		if (a.paths[0]) lines.push(`    ${a.paths[0]}`);
	}
	return `${lines.join("\n")}\n`;
}

export function formatMarkdown(parsed) {
	const lines = [
		"## npm audit",
		"",
		"| Severity | Count |",
		"|---|---|",
		`| Critical | ${parsed.critical} |`,
		`| High | ${parsed.high} |`,
		`| Moderate | ${parsed.moderate} |`,
		`| Low | ${parsed.low} |`,
		`| Info | ${parsed.info} |`,
		`| **Total** | **${parsed.total}** |`,
		"",
	];
	if (parsed.advisories.length === 0) {
		lines.push("No advisories.");
		return `${lines.join("\n")}\n`;
	}
	lines.push("### Advisories", "");
	for (const a of parsed.advisories) {
		const id = a.ghsa || a.cves.join(", ") || a.id;
		const link = a.url ? `[${id}](${a.url})` : id;
		lines.push(`- **${a.severity}** \`${a.module}\` ${link} — ${a.title}`);
		lines.push(`  - vulnerable: \`${a.vulnerable}\`; patched: \`${a.patched}\``);
		if (a.paths[0]) lines.push(`  - ${a.paths[0]}`);
	}
	return `${lines.join("\n")}\n`;
}

export function highCritical(parsed) {
	return parsed.advisories.filter((a) => a.severity === "high" || a.severity === "critical");
}
