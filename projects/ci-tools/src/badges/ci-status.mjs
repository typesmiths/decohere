import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBadgeSvg, statusToColor, statusToText } from "../lib/svg.mjs";

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const outputDir =
	process.env.CI_BADGE_OUTPUT_DIR ?? path.join("projects", "ci-tools", "dist", "ci", "badges");

if (repo == null || token == null) {
	throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
}

const workflowFileName = "ci.yml";

const branches = [{ branch: "main", label: "CI Main", file: "ci-main.svg" }];

async function getLatestWorkflowRun(branch) {
	const url =
		`https://api.github.com/repos/${repo}/actions/workflows/${workflowFileName}/runs` +
		`?branch=${branch}&event=push&status=completed&per_page=1`;
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
		},
	});

	if (!response.ok) {
		process.stderr.write(
			`Warning: Failed to fetch workflow runs for ${branch}: ${response.status}. Using unknown badge status.\n`,
		);
		return null;
	}

	const data = await response.json();
	return data.workflow_runs?.[0] ?? null;
}

await mkdir(outputDir, { recursive: true });

for (const item of branches) {
	const latestRun = await getLatestWorkflowRun(item.branch);
	const status = latestRun?.status ?? "completed";
	const conclusion = latestRun?.conclusion ?? "unknown";
	const value = statusToText(status, conclusion);
	const color = statusToColor(status, conclusion);
	await writeFile(path.join(outputDir, item.file), createBadgeSvg(item.label, value, color));
}
