import { describe, expect, it } from "vitest";
import {
	getProjectFromPath,
	parseLcovByProject,
	parseLcovFiles,
} from "../../src/lib/lcov.mjs";

const sampleLcov = `SF:projects/forge/src/index.ts
LF:10
LH:9
end_of_record
SF:projects/forge/src/build/index.ts
LF:20
LH:15
end_of_record
SF:projects/core/src/index.ts
LF:5
LH:5
end_of_record
`;

const sampleLcovWithLines = `SF:projects/anvil/src/index.ts
DA:1,1
DA:2,1
DA:3,0
DA:4,0
DA:5,1
LF:5
LH:3
end_of_record
`;

describe("getProjectFromPath", () => {
	it("extracts project name from projects/ path", () => {
		expect(getProjectFromPath("projects/forge/src/index.ts")).toBe("forge");
	});

	it("returns undefined for unrecognized paths", () => {
		expect(getProjectFromPath("src/index.ts")).toBeUndefined();
	});
});

describe("parseLcovByProject", () => {
	it("groups files by project and sums coverage", () => {
		const result = parseLcovByProject(sampleLcov);
		expect(result.get("forge")).toBeDefined();
		expect(result.get("forge").totalLines).toBe(30);
		expect(result.get("forge").coveredLines).toBe(24);
		expect(result.get("core")).toBeDefined();
		expect(result.get("core").totalLines).toBe(5);
		expect(result.get("core").coveredLines).toBe(5);
	});

	it("ignores records with LF:0", () => {
		const lcov = `SF:projects/forge/src/empty.ts\nLF:0\nLH:0\nend_of_record\n`;
		const result = parseLcovByProject(lcov);
		expect(result.size).toBe(0);
	});
});

describe("parseLcovFiles", () => {
	it("returns per-file coverage with uncovered line numbers", () => {
		const result = parseLcovFiles(sampleLcovWithLines);
		const file = result.find((f) => f.sourcePath === "projects/anvil/src/index.ts");
		expect(file).toBeDefined();
		expect(file.totalLines).toBe(5);
		expect(file.coveredLines).toBe(3);
		expect(file.uncoveredLineNumbers).toEqual([3, 4]);
		expect(file.uncoveredLines).toBe(2);
	});

	it("includes files with 100% coverage", () => {
		const lcov = `SF:projects/anvil/src/full.ts\nDA:1,1\nDA:2,1\nLF:2\nLH:2\nend_of_record\n`;
		const result = parseLcovFiles(lcov);
		expect(result).toHaveLength(1);
		expect(result[0].uncoveredLineNumbers).toEqual([]);
	});

	it("excludes files with LF:0", () => {
		const lcov = `SF:projects/anvil/src/empty.ts\nLF:0\nLH:0\nend_of_record\n`;
		const result = parseLcovFiles(lcov);
		expect(result).toHaveLength(0);
	});
});
