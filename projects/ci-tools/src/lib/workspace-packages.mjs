import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The same rule as WorkspaceDefaults in @decohere/workspace (`projects/**/package.json`, minus these
// folders, and a package.json inside another project is not a project). CI scripts run on plain
// Node before any install, so they can't import the workspace package itself.
const SKIP = new Set(["node_modules", "__fixtures__", "dist"]);

/**
 * Every project directory under `<root>/projects`, at any depth (`projects/cli`,
 * `projects/data/data-typeorm`).
 * @param {string} root
 * @returns {string[]} absolute paths
 */
export function listProjectDirs(root) {
	const found = [];
	const walk = (dir) => {
		if (existsSync(join(dir, "package.json"))) {
			found.push(dir);
			return;
		}
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory() && !SKIP.has(entry.name) && !entry.name.startsWith(".")) {
				walk(join(dir, entry.name));
			}
		}
	};
	walk(join(root, "projects"));
	return found;
}
