#!/usr/bin/env node
/**
 * Capture final version metadata from package.json
 * Outputs version and is_prerelease flags for GitHub Actions
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
	const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
	const version = packageJson.version;

	if (!version) {
		console.error("No version found in package.json");
		process.exit(1);
	}

	console.log(`version=${version}`);

	// Check if prerelease (has hyphen in version)
	const isPrerelease = version.includes("-");
	console.log(`is_prerelease=${isPrerelease}`);
} catch (e) {
	console.error(`Failed to capture version: ${e.message}`);
	process.exit(1);
}
