import { describe, expect, it } from "vitest";
import {
	formatLog,
	formatMarkdown,
	highCritical,
	parseAudit,
} from "../../src/audit/format.mjs";

const fixture = {
	metadata: {
		vulnerabilities: { info: 0, low: 1, moderate: 0, high: 1, critical: 0, total: 2 },
	},
	advisories: {
		1: {
			id: 1,
			module_name: "nanoid",
			severity: "high",
			title: "nanoid: custom generators can loop indefinitely when size is zero",
			url: "https://github.com/advisories/GHSA-2v37-7h3g-55p8",
			vulnerable_versions: "<3.3.18",
			patched_versions: ">=3.3.18",
			cves: [],
			findings: [{ version: "3.3.17", paths: [". > vite > postcss > nanoid@3.3.17"] }],
		},
		2: {
			id: 2,
			module_name: "esbuild",
			severity: "low",
			title: "esbuild Windows file read",
			url: "https://github.com/advisories/GHSA-g7r4-m6w7-qqqr",
			vulnerable_versions: "<0.28.1",
			patched_versions: ">=0.28.1",
			cves: [],
			findings: [{ version: "0.27.3", paths: [". > vite > esbuild"] }],
		},
	},
};

describe("parseAudit", () => {
	it("reads severity counts and sorts advisories critical/high first", () => {
		const parsed = parseAudit(fixture);
		expect(parsed.total).toBe(2);
		expect(parsed.high).toBe(1);
		expect(parsed.low).toBe(1);
		expect(parsed.advisories.map((a) => a.module)).toEqual(["nanoid", "esbuild"]);
		expect(parsed.advisories[0]?.severity).toBe("high");
		expect(parsed.advisories[0]?.ghsa).toBe("GHSA-2v37-7h3g-55p8");
	});
});

describe("formatLog", () => {
	it("prints severity counts and advisory lines including GHSA", () => {
		const log = formatLog(parseAudit(fixture));
		expect(log).toContain("high=1");
		expect(log).toContain("[high] nanoid GHSA-2v37-7h3g-55p8");
		expect(log).toContain("[low] esbuild");
	});
});

describe("formatMarkdown", () => {
	it("includes a severity table and linked advisories", () => {
		const md = formatMarkdown(parseAudit(fixture));
		expect(md).toContain("| High | 1 |");
		expect(md).toContain("**high** `nanoid`");
		expect(md).toContain("GHSA-2v37-7h3g-55p8");
	});
});

describe("highCritical", () => {
	it("filters to high and critical only", () => {
		expect(highCritical(parseAudit(fixture)).map((a) => a.module)).toEqual(["nanoid"]);
	});
});

describe("parseAudit npm v2", () => {
	it("dedupes GHSA rows from package via objects", () => {
		const v2 = {
			auditReportVersion: 2,
			metadata: {
				vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
			},
			vulnerabilities: {
				nanoid: {
					name: "nanoid",
					severity: "high",
					via: [
						{
							source: 1103848,
							name: "nanoid",
							title: "nanoid infinite loop",
							url: "https://github.com/advisories/GHSA-2v37-7h3g-55p8",
							severity: "high",
							range: "<3.3.18",
						},
					],
					range: "<3.3.18",
					nodes: ["node_modules/.pnpm/nanoid@3.3.17/node_modules/nanoid"],
				},
				postcss: {
					name: "postcss",
					severity: "high",
					via: ["nanoid"],
					effects: [],
					range: "*",
					nodes: ["node_modules/.pnpm/postcss@8.5.26/node_modules/postcss"],
				},
			},
		};
		const parsed = parseAudit(v2);
		expect(parsed.advisories).toHaveLength(1);
		expect(parsed.advisories[0]?.module).toBe("nanoid");
		expect(parsed.advisories[0]?.ghsa).toBe("GHSA-2v37-7h3g-55p8");
		expect(parsed.advisories[0]?.vulnerable).toBe("<3.3.18");
	});
});
