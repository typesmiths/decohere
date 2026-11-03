/**
 * The GitHub issue for a benchmark that got slower: one open issue per benchmark,
 * found again by its exact title and updated in place while the regression lasts.
 */

const PAGES_URL = "https://typesmiths.github.io/decohere/benchmark.html";

export function issueTitle(regression) {
	return `perf(bench): ${regression.id} is slower`;
}

function ms(value) {
	return `${value.toFixed(1)} ms`;
}

function short(sha) {
	return sha.slice(0, 7);
}

export function issueBody(regression, { repoUrl, runUrl, machine, threshold, base, head }) {
	const range = `[${short(base)}...${short(head)}](${repoUrl}/compare/${base}...${head})`;
	return [
		"## Problem",
		"",
		`The nightly benchmark **${regression.label}** (\`${regression.id}\`) is ${regression.percent.toFixed(0)}% slower on [\`${short(head)}\`](${repoUrl}/commit/${head}) than on [\`${short(base)}\`](${repoUrl}/commit/${base}), the commit the previous nightly measured. Both ran on the same runner, alternately, and head was more than ${Math.round(threshold * 100)}% slower in every round.`,
		"",
		"| Round | Base | Head |",
		"|---|---|---|",
		...regression.rounds.map(
			(round, index) => `| ${index + 1} | ${ms(round.base)} | ${ms(round.head)} |`,
		),
		"",
		`- Machine: ${machine}`,
		`- Commits: ${range}`,
		"",
		"## What to do",
		"",
		`1. Look through the commits in ${range} for the change.`,
		`2. Reproduce locally: check out \`${short(base)}\`, run \`pnpm bench:save\`, then check out \`${short(head)}\` and run \`pnpm bench\` to compare.`,
		`3. Fix the cause, or if the slowdown is intended, say why here and close the issue. Trend: [benchmark page](${PAGES_URL}).`,
		"",
		`Updated by the nightly bench workflow: ${runUrl}`,
	].join("\n");
}
