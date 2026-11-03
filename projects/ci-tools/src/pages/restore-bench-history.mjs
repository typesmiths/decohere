#!/usr/bin/env node

// Restore benchmark history from Pages. Only a 404 (never published, or cleared) starts an
// empty history: any other failure stops the job, so a network blip can't wipe the trend on
// the next save.

import { mkdir, writeFile } from "node:fs/promises";

const HISTORY_DIR = "projects/ci-tools/dist/ci/bench";
const HISTORY_FILE = `${HISTORY_DIR}/bench-history.json`;
const PAGES_URL = process.env.PAGES_URL ?? "https://typesmiths.github.io/decohere";

await mkdir(HISTORY_DIR, { recursive: true });
const response = await fetch(`${PAGES_URL}/data/bench-history.json`);
if (response.status === 404) {
	console.log("No benchmark history on Pages; starting from empty history");
	await writeFile(HISTORY_FILE, `${JSON.stringify({ version: 2, contexts: {} }, null, 2)}\n`);
} else if (!response.ok) {
	console.error(`Failed to restore benchmark history: HTTP ${response.status}`);
	process.exit(1);
} else {
	await writeFile(HISTORY_FILE, await response.text());
	console.log("✓ Restored benchmark history from Pages");
}
