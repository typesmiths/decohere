import type { ShellResponse } from "../shell/shell.types.js";

export interface PackageManager {
	readonly name: "npm" | "pnpm" | "yarn";
	install(options?: { cwd?: string }): Promise<ShellResponse>;
	syncLockFile(options?: { cwd?: string }): Promise<ShellResponse>;
}
