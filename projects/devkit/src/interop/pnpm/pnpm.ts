import { Shell } from "../shell/shell.js";
import type { PackageManager } from "../types/package-manager.js";
import type { PnpmOptions } from "./pnpm.types.js";

const Commands = {
	install: "install",
};

export class Pnpm extends Shell implements PackageManager {
	public readonly name = "pnpm" as const;
	protected program: string = "pnpm";

	public async install(options: PnpmOptions = { cwd: "./" }) {
		const { cwd } = options;
		return this.run({ cwd }, Commands.install);
	}

	public async syncLockFile(options: PnpmOptions = { cwd: "./" }) {
		const { cwd } = options;
		return this.run({ cwd }, Commands.install, "--lockfile-only", "--ignore-scripts");
	}
}
