#!/usr/bin/env node
/**
 * Generate npm package links for all @decohere packages
 * Outputs markdown formatted links for GitHub release notes
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listProjectDirs } from "../lib/workspace-packages.mjs";

const VERSION = process.argv[2] || process.env.VERSION;

if (!VERSION) {
	console.error("VERSION not provided as argument or env var");
	process.exit(1);
}

let links = "## Published Packages\n\n";

try {
	for (const projectDir of listProjectDirs(process.cwd())) {
		const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
		if (pkg.name?.startsWith("@decohere/")) {
			links += `- [\`${pkg.name}@${VERSION}\`](https://www.npmjs.com/package/${pkg.name}/v/${VERSION})\n`;
		}
	}

	console.log(links);
} catch (e) {
	console.error(`Failed to generate npm links: ${e.message}`);
	process.exit(1);
}
