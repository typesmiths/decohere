import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseLcovByProject } from "../lib/lcov.mjs";
import { createBadgeSvg, getColor } from "../lib/svg.mjs";

const summaryPath = path.resolve("dist/coverage/coverage-summary.json");
const lcovPath = path.resolve("dist/coverage/lcov.info");
const badgesDirectory = path.resolve("projects/ci-tools/dist/ci/badges");
const globalBadgePath = path.join(badgesDirectory, "coverage.svg");
const projectBadgesDirectory = path.join(badgesDirectory, "projects");

if (!existsSync(summaryPath)) {
	throw new Error(`Coverage summary not found: ${summaryPath}`);
}

if (!existsSync(lcovPath)) {
	throw new Error(`LCOV file not found: ${lcovPath}`);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const linesCoverage = summary?.total?.lines?.pct;

if (typeof linesCoverage !== "number" || Number.isNaN(linesCoverage)) {
	throw new Error("Invalid coverage summary: missing total.lines.pct");
}

const percentage = Number(linesCoverage.toFixed(1));
const color = getColor(percentage);

mkdirSync(badgesDirectory, { recursive: true });
writeFileSync(globalBadgePath, createBadgeSvg("Coverage", `${percentage}%`, color));

mkdirSync(projectBadgesDirectory, { recursive: true });
for (const entry of existsSync(projectBadgesDirectory)
	? readdirSync(projectBadgesDirectory)
	: []) {
	if (entry.endsWith(".svg")) {
		rmSync(path.join(projectBadgesDirectory, entry));
	}
}

const projectCoverage = parseLcovByProject(readFileSync(lcovPath, "utf8"));
for (const [project, metrics] of [...projectCoverage.entries()].sort(([a], [b]) =>
	a.localeCompare(b),
)) {
	if (metrics.totalLines === 0) continue;
	const pct = Number(((metrics.coveredLines / metrics.totalLines) * 100).toFixed(1));
	const projectBadgePath = path.join(projectBadgesDirectory, `${project}.svg`);
	writeFileSync(projectBadgePath, createBadgeSvg(project, `${pct}%`, getColor(pct)));
}
