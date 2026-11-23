/**
 * `pnpm design:check`: measures the code against ADR 0027 and compares each package's counts with
 * the committed baseline. A count above it fails; a count below it fails too, until the baseline
 * is lowered with `--update`, so it can never rise back. `--update` writes today's counts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { CodeDesign, RULES } from "./code-design.service.mjs";

export const BASELINE = "projects/ci-tools/src/design/baseline.json";

/**
 * @param {{ argv?: string[], root?: string, log?: (line: string) => void }} [options]
 * @returns {number} exit code
 */
export function runDesignCheck(options = {}) {
	const { values } = parseArgs({
		args: options.argv ?? process.argv.slice(2),
		options: { update: { type: "boolean", default: false } },
	});
	const root = options.root ?? process.cwd();
	const log = options.log ?? ((line) => process.stdout.write(`${line}\n`));
	const measured = new CodeDesign(root).measure();
	const counts = Object.fromEntries(
		Object.entries(measured).map(([pkg, rules]) => [
			pkg,
			Object.fromEntries(Object.entries(rules).map(([rule, { count }]) => [rule, count])),
		]),
	);
	const path = join(root, BASELINE);

	if (values.update) {
		mkdirSync(dirname(path), { recursive: true });
		// Two spaces, as Prettier formats JSON here, so an update changes only the counts.
		writeFileSync(path, `${JSON.stringify(counts, null, 2)}\n`);
		log(`design: wrote the baseline (${total(counts)} breaks of ADR 0027 in all).`);
		return 0;
	}

	/** @type {Record<string, Record<string, number>>} */
	const baseline = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
	const rose = [];
	const fell = [];
	for (const pkg of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
		for (const rule of Object.keys(RULES)) {
			const now = counts[pkg]?.[rule] ?? 0;
			const was = baseline[pkg]?.[rule] ?? 0;
			if (now > was) {
				// The baseline keeps counts, not places, so the new ones are somewhere in this list.
				const where = measured[pkg][rule].where;
				rose.push(
					`design: ${pkg}  ${RULES[rule]}  ${was} → ${now}  (+${now - was}), among:\n  ${where.join("\n  ")}`,
				);
			}
			if (now < was) {
				fell.push(`design: ${pkg}  ${RULES[rule]}  ${was} → ${now}`);
			}
		}
	}

	log(
		`design: ${total(counts)} breaks of ADR 0027 (docs/contributing/adr/0027-code-design.md).`,
	);
	if (rose.length > 0) {
		log(rose.join("\n"));
		log(
			"Rules broken more than the baseline allows. Fix the code; ADR 0027 says how it should be.",
		);
		return 1;
	}
	if (fell.length > 0) {
		log(fell.join("\n"));
		log(
			"Fewer breaks than the baseline: lower it, so they can't come back: pnpm design:check --update",
		);
		return 1;
	}
	return 0;
}

/** @param {Record<string, Record<string, number>>} counts */
function total(counts) {
	return Object.values(counts).reduce(
		(sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0),
		0,
	);
}
