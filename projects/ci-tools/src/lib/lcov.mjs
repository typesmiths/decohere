/**
 * Shared LCOV file parsing utilities.
 */

/**
 * Normalizes a file path to use forward slashes.
 * @param {string} filePath
 * @returns {string}
 */
function normalizePath(filePath) {
	return filePath.replaceAll("\\", "/");
}

/**
 * Extracts the top-level project name from a source path like
 * `/workspace/projects/hearth/src/foo.ts` → `"hearth"`.
 * @param {string} sourcePath
 * @returns {string | undefined}
 */
export function getProjectFromPath(sourcePath) {
	const match = sourcePath.match(/(?:^|\/)projects\/([^/]+)\//);
	return match?.[1];
}

/**
 * Parses an LCOV file and returns per-project line coverage totals.
 * Uses the LF (lines found) and LH (lines hit) summary fields.
 *
 * @param {string} content  Raw LCOV file content.
 * @returns {Map<string, { totalLines: number; coveredLines: number }>}
 */
export function parseLcovByProject(content) {
	const records = content
		.split("end_of_record")
		.map((record) => record.trim())
		.filter(Boolean);

	const byProject = new Map();

	for (const record of records) {
		const lines = record.split("\n");
		let sourcePath = "";
		let totalLines = 0;
		let coveredLines = 0;

		for (const line of lines) {
			if (line.startsWith("SF:")) {
				sourcePath = normalizePath(line.slice(3));
			} else if (line.startsWith("LF:")) {
				totalLines = Number(line.slice(3));
			} else if (line.startsWith("LH:")) {
				coveredLines = Number(line.slice(3));
			}
		}

		const project = getProjectFromPath(sourcePath);
		if (project == null || totalLines === 0) continue;

		const current = byProject.get(project) ?? { totalLines: 0, coveredLines: 0 };
		current.totalLines += totalLines;
		current.coveredLines += coveredLines;
		byProject.set(project, current);
	}

	return byProject;
}

/**
 * Parses an LCOV file into per-file records including uncovered line numbers.
 * Suitable for detailed reporting.
 *
 * @param {string} content  Raw LCOV file content.
 * @returns {Array<{
 *   sourcePath: string;
 *   project: string | undefined;
 *   totalLines: number;
 *   coveredLines: number;
 *   uncoveredLines: number;
 *   uncoveredLineNumbers: number[];
 * }>}
 */
export function parseLcovFiles(content) {
	const records = content
		.split("end_of_record")
		.map((record) => record.trim())
		.filter(Boolean);

	const files = [];

	for (const record of records) {
		const lines = record.split("\n");
		let sourcePath = "";
		let totalLines = 0;
		let coveredLines = 0;
		const uncoveredLineNumbers = [];

		for (const line of lines) {
			if (line.startsWith("SF:")) {
				sourcePath = normalizePath(line.slice(3));
			} else if (line.startsWith("LF:")) {
				totalLines = Number(line.slice(3));
			} else if (line.startsWith("LH:")) {
				coveredLines = Number(line.slice(3));
			} else if (line.startsWith("DA:")) {
				const [lineNumberText, hitCountText] = line.slice(3).split(",");
				const lineNumber = Number(lineNumberText);
				const hitCount = Number(hitCountText);
				if (!Number.isNaN(lineNumber) && !Number.isNaN(hitCount) && hitCount === 0) {
					uncoveredLineNumbers.push(lineNumber);
				}
			}
		}

		if (sourcePath.length === 0 || totalLines === 0) continue;

		files.push({
			sourcePath,
			project: getProjectFromPath(sourcePath),
			totalLines,
			coveredLines,
			uncoveredLines: totalLines - coveredLines,
			uncoveredLineNumbers: uncoveredLineNumbers.sort((a, b) => a - b),
		});
	}

	return files;
}
