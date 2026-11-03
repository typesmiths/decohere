#!/usr/bin/env node

// Restore the badges on the live Pages site into dist, so a deploy that does not regenerate
// them (the nightly bench) keeps them. Pages replaces the whole site on every deploy.
//
// The site lists its badges in badges/manifest.json (artifact.mjs). Sites deployed before the
// manifest existed are read with a fixed list instead. A badge the site does not have (404) is
// skipped; any other failure stops the job.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BADGES_DIR = "projects/ci-tools/dist/ci/badges";
const PAGES_URL = process.env.PAGES_URL ?? "https://typesmiths.github.io/decohere";

const LEGACY_BADGES = [
	"ci-main.svg",
	"ci-release.svg",
	"coverage.svg",
	...[
		"ci-tools",
		"cli",
		"codex",
		"cortex",
		"create",
		"crucible",
		"flux",
		"forge",
		"mesh",
		"nexus",
		"protocol",
		"scribe",
		"terminal",
	].map((project) => `projects/${project}.svg`),
];

async function fetchOrNull(url) {
	const response = await fetch(url);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
	return response;
}

const manifest = await fetchOrNull(`${PAGES_URL}/badges/manifest.json`);
const badges = manifest != null ? (await manifest.json()).badges : LEGACY_BADGES;

let restored = 0;
for (const badge of badges) {
	const response = await fetchOrNull(`${PAGES_URL}/badges/${badge}`);
	if (response == null) continue;
	const file = path.join(BADGES_DIR, badge);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, await response.text());
	restored += 1;
}
console.log(
	`✓ Restored ${restored} badge(s) from Pages (${manifest != null ? "manifest" : "legacy list"})`,
);
