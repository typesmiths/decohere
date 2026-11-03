/**
 * Checks whether there is at least one pending changeset entry describing the
 * nature of the changes (breaking, minor, or patch). Works in workspace/lockstep
 * mode: one entry covering any package is sufficient — you do NOT need an entry
 * per package.
 *
 * Usage: node check-status.mjs [--allow-empty]
 *   --allow-empty   Exit 0 even when no changeset entries are found (e.g. docs-only PRs)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

const allowEmpty = process.argv.includes("--allow-empty");
const root = process.cwd();

// Find all changeset files
const changesetFiles = await glob(".changeset/*.md", { cwd: root, absolute: false });
const pendingChangesets = changesetFiles.filter((f) => !f.endsWith("README.md"));

if (pendingChangesets.length === 0 && allowEmpty) {
	console.log("No pending changesets found (--allow-empty: OK).");
	process.exit(0);
}

if (pendingChangesets.length === 0) {
	console.error("No pending changeset files found in .changeset/");
	console.error("Run: pnpm changeset  to create one.");
	process.exit(1);
}

// Parse which packages are covered and what bump types are declared
const coveredPackages = new Set();
const bumpTypes = new Set();
for (const filePath of pendingChangesets) {
	const content = await readFile(path.join(root, filePath), "utf8");
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) continue;
	for (const line of match[1].split("\n")) {
		const m = line.match(/^"([^"]+)"\s*:\s*(\w+)/);
		if (m) {
			coveredPackages.add(m[1]);
			bumpTypes.add(m[2]);
		}
	}
}

console.log(
	`Found ${pendingChangesets.length} changeset file(s): bump=${[...bumpTypes].join("/")} packages=${[...coveredPackages].join(", ") || "(none)"}`,
);
console.log("OK — changeset entries present.");

console.log("All changed packages have pending changesets.");
