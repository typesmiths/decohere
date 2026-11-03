import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { PACKAGE_JSON, PROJECTS_DIR } from "../const.js";

/**
 * The workspace root for a command run from `startDir`: the nearest directory at or above
 * it with a `package.json` and a `projects/` folder. Falls back to `startDir`, so running
 * from a package directory (`projects/api`) still sees the whole workspace.
 */
export function findWorkspaceRoot(startDir: string): string {
	const start = path.resolve(startDir);
	let dir = start;
	for (;;) {
		if (
			existsSync(path.join(dir, PACKAGE_JSON)) &&
			isDirectory(path.join(dir, PROJECTS_DIR))
		) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) return start;
		dir = parent;
	}
}

function isDirectory(fullPath: string): boolean {
	try {
		return statSync(fullPath).isDirectory();
	} catch {
		return false;
	}
}
