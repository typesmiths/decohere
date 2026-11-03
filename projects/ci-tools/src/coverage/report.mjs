import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLcovFiles } from "../lib/lcov.mjs";

function parseArgs(argv) {
	const options = {
		lcov: ".forge/coverage/lcov.info",
		project: undefined,
		pathPrefix: undefined,
		top: undefined,
		json: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--lcov") {
			options.lcov = argv[index + 1] ?? options.lcov;
			index += 1;
			continue;
		}
		if (arg === "--project") {
			options.project = argv[index + 1] ?? options.project;
			index += 1;
			continue;
		}
		if (arg === "--pathPrefix") {
			options.pathPrefix = argv[index + 1] ?? options.pathPrefix;
			index += 1;
			continue;
		}
		if (arg === "--top") {
			const parsed = Number(argv[index + 1]);
			if (!Number.isNaN(parsed) && parsed > 0) options.top = parsed;
			index += 1;
			continue;
		}
		if (arg === "--json") options.json = true;
	}

	return options;
}

function formatLineRanges(lines) {
	if (lines.length === 0) return "-";
	const ranges = [];
	let rangeStart = lines[0];
	let previous = lines[0];
	for (const current of lines.slice(1)) {
		if (current === previous + 1) {
			previous = current;
			continue;
		}
		ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
		rangeStart = current;
		previous = current;
	}
	ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
	return ranges.join(",");
}

function padRight(value, width) {
	const text = String(value);
	return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function printHumanReport(files, options) {
	const totalLines = files.reduce((sum, file) => sum + file.totalLines, 0);
	const coveredLines = files.reduce((sum, file) => sum + file.coveredLines, 0);
	const uncoveredLines = totalLines - coveredLines;
	const linePct = totalLines === 0 ? 100 : (coveredLines / totalLines) * 100;

	const headerProject = options.project == null ? "all projects" : options.project;
	console.log(`Uncovered lines report (${headerProject})`);
	console.log(
		`Scope lines: ${coveredLines}/${totalLines} covered (${linePct.toFixed(2)}%), ${uncoveredLines} uncovered`,
	);
	console.log("");

	if (files.length === 0) {
		console.log("No uncovered files found for this scope.");
		return;
	}

	const pathWidth = Math.min(
		100,
		Math.max("File".length, ...files.map((file) => file.sourcePath.length)),
	);
	console.log(
		`${padRight("Uncovered", 10)} ${padRight("File", pathWidth)} ${padRight("Line %", 7)} Uncovered line ranges`,
	);
	console.log(`${"-".repeat(10)} ${"-".repeat(pathWidth)} ${"-".repeat(7)} ${"-".repeat(24)}`);

	for (const file of files) {
		const pct = file.totalLines === 0 ? 100 : (file.coveredLines / file.totalLines) * 100;
		console.log(
			`${padRight(file.uncoveredLines, 10)} ${padRight(file.sourcePath, pathWidth)} ${padRight(pct.toFixed(2), 7)} ${formatLineRanges(file.uncoveredLineNumbers)}`,
		);
	}
}

const options = parseArgs(process.argv.slice(2));
const lcovPath = resolve(options.lcov);

if (!existsSync(lcovPath)) {
	console.error(`LCOV file not found: ${lcovPath}`);
	console.error("Run coverage first (example: npm run test:coverage)");
	process.exit(1);
}

const files = parseLcovFiles(readFileSync(lcovPath, "utf8"));
const filtered = files.filter((file) => {
	if (options.project == null) {
		return options.pathPrefix == null
			? file.project != null
			: file.sourcePath.startsWith(options.pathPrefix);
	}
	if (file.project !== options.project) return false;
	return options.pathPrefix == null || file.sourcePath.startsWith(options.pathPrefix);
});

const uncoveredOnly = filtered
	.filter((file) => file.uncoveredLines > 0)
	.sort(
		(left, right) =>
			right.uncoveredLines - left.uncoveredLines ||
			left.sourcePath.localeCompare(right.sourcePath),
	);

const ranked = options.top == null ? uncoveredOnly : uncoveredOnly.slice(0, options.top);

if (options.json) {
	console.log(
		JSON.stringify({ scope: options.project ?? "all", lcovPath, files: ranked }, null, 2),
	);
	process.exit(0);
}

printHumanReport(ranked, options);
