#!/usr/bin/env node
/**
 * Sync cross-library dependency versions
 * Conditionally runs sync with or without commit based on DRY_RUN flag
 */

import { execSync } from "node:child_process";

const DRY_RUN = process.env.DRY_RUN === "true";
const DECOHERE_CONFIG = process.env.DECOHERE_CONFIG || ".decohere.js";

const baseCmd = `pnpm forge --log-level info --config-file "${DECOHERE_CONFIG}" dependencies --configuration release sync`;

try {
	if (DRY_RUN) {
		console.log(`[DRY RUN] ${baseCmd}`);
		execSync(baseCmd, { stdio: "inherit" });
	} else {
		const commitCmd = `${baseCmd} --commit --message "chore: version packages and sync cross-library dependencies [skip ci]"`;
		console.log(`Syncing with commit...`);
		execSync(commitCmd, { stdio: "inherit" });
	}
} catch (e) {
	console.error(`Dependency sync failed: ${e.message}`);
	process.exit(1);
}
