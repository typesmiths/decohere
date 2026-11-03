/**
 * Aggregates pending .changeset/*.md entries into the root CHANGELOG.md,
 * then deletes the consumed entry files.
 *
 * Changeset entry format:
 *   ---
 *   "@pkg/name": major|minor|patch
 *   ---
 *   Human-readable description of the change.
 *
 * Usage: node aggregate-changelog.mjs [--dry-run]
 *   --dry-run   Print what would be written without modifying any files.
 */

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const root = process.cwd();
const changesetDir = join(root, ".changeset");

/** Bump type precedence (higher = more significant) */
const PRECEDENCE = { major: 3, minor: 2, patch: 1, prerelease: 0 };

/** Section headers for each bump type */
const SECTION_HEADINGS = {
	major: "Breaking Changes",
	minor: "Minor Changes",
	patch: "Patch Changes",
};

let entries;
try {
	const allFiles = await readdir(changesetDir);
	entries = allFiles.filter((f) => f.endsWith(".md") && f !== "README.md");
} catch {
	console.log("No .changeset directory found. Nothing to aggregate.");
	process.exit(0);
}

if (entries.length === 0) {
	console.log("No pending changeset entries found. Nothing to aggregate.");
	process.exit(0);
}

/** Parse a single changeset file → { packages: Record<string, string>, body: string } */
function parseEntry(content) {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return null;
	const packages = {};
	for (const line of match[1].split("\n")) {
		const m = line.match(/^"([^"]+)"\s*:\s*(\w+)/);
		if (m) packages[m[1]] = m[2];
	}
	return { packages, body: match[2].trim() };
}

/** Group entries into sections by the highest bump type they declare */
const sections = { major: [], minor: [], patch: [] };

for (const file of entries) {
	const content = await readFile(join(changesetDir, file), "utf8");
	const parsed = parseEntry(content);
	if (!parsed) {
		console.warn(`Skipping malformed changeset: ${file}`);
		continue;
	}

	const bumpTypes = Object.values(parsed.packages);
	const highestBump = bumpTypes.reduce((max, t) => {
		return (PRECEDENCE[t] ?? -1) > (PRECEDENCE[max] ?? -1) ? t : max;
	}, "patch");

	const section = sections[highestBump] ?? sections.patch;
	const pkgList = Object.keys(parsed.packages)
		.map((p) => `\`${p}\``)
		.join(", ");
	section.push(`- **${pkgList}**: ${parsed.body}`);
}

const date = new Date().toISOString().slice(0, 10);
const sectionBlocks = [];

for (const [type, heading] of Object.entries(SECTION_HEADINGS)) {
	if (sections[type].length > 0) {
		sectionBlocks.push(`### ${heading}\n\n${sections[type].join("\n")}`);
	}
}

if (sectionBlocks.length === 0) {
	console.log("No parseable changeset entries. Nothing written.");
	process.exit(0);
}

const newEntry = `## ${date}\n\n${sectionBlocks.join("\n\n")}\n\n`;

let existing = "";
try {
	existing = await readFile(join(root, "CHANGELOG.md"), "utf8");
} catch {
	/* new file */
}

if (dryRun) {
	console.log("[dry-run] Would prepend to CHANGELOG.md:");
	console.log(newEntry);
	console.log(`[dry-run] Would delete ${entries.length} changeset file(s):`, entries);
	process.exit(0);
}

await writeFile(join(root, "CHANGELOG.md"), newEntry + existing);
console.log(`Wrote aggregated changelog with ${entries.length} changeset(s).`);

for (const file of entries) {
	await rm(join(changesetDir, file));
}
console.log(`Deleted ${entries.length} consumed changeset file(s).`);

console.log(`Wrote aggregated changelog with ${sections.length} package(s).`);
