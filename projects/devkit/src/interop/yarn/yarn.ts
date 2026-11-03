import { Shell } from "../shell/shell.js";
import type { PackageManager } from "../types/package-manager.js";
import type { YarnOptions } from "./yarn.types.js";

const Commands = {
	install: "install",
};

export class Yarn extends Shell implements PackageManager {
	public readonly name = "yarn" as const;
	protected program: string = "yarn";

	public async install(options: YarnOptions = { cwd: "./" }) {
		const { cwd } = options;
		return this.run({ cwd }, Commands.install);
	}

	public async syncLockFile(options: YarnOptions = { cwd: "./" }) {
		const { cwd } = options;
		return this.run(
			{ cwd },
			Commands.install,
			"--mode",
			"update-lockfile",
			"--ignore-scripts",
		);
	}
}
