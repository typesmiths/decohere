/**
 * The file roles (`<thing>.<role>.ts`) the shared rules allow, read from the installed
 * `@decohere/standards`, so Decohere keeps no copy of its own that can drift from them.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the standards' table of file roles sits, from the workspace root. */
export const STANDARD_ROLES = "node_modules/@decohere/standards/rules/files-and-folders.md";

/** A row of the table: its first cell names one role or several, as `.role.ts`. */
const ROW = /^\|([^|]*)\|/;
const ROLE = /`\.([a-z][a-z-]*)\.ts`/g;

export class FileRoles {
	/** @param {string} root the workspace root */
	constructor(root) {
		const path = join(root, STANDARD_ROLES);
		if (!existsSync(path)) {
			throw new Error(
				`design: ${STANDARD_ROLES} is missing, so the file roles are unknown. Run pnpm install.`,
			);
		}
		/** @private */
		this.roles = new Set();
		for (const line of readFileSync(path, "utf8").split("\n")) {
			const cell = ROW.exec(line)?.[1] ?? "";
			for (const [, role] of cell.matchAll(ROLE)) {
				this.roles.add(role);
			}
		}
		if (this.roles.size === 0) {
			throw new Error(
				`design: ${STANDARD_ROLES} lists no file roles; its table has changed shape.`,
			);
		}
	}

	/** @param {string} role a file name's last part before `.ts`, such as `service` */
	has(role) {
		return this.roles.has(role);
	}
}
