import { type SpawnOptions, spawn } from "node:child_process";
import { Shell } from "../shell/shell.js";

export class Node extends Shell {
	protected program: string = "node";

	public async runScript(script: string, ...args: string[]) {
		const spawnOpt: SpawnOptions = {
			cwd: ".",
			stdio: "inherit",
			env: {
				...process.env,
			},
		};

		return new Promise((resolve, reject) => {
			const proc = spawn("node", [script, ...args], spawnOpt);

			proc.on("exit", (code) => {
				if (code !== 0) {
					reject();
				}

				resolve(null);
			});

			proc.on("close", (code) => {
				resolve(null);
				if (code === 0) {
					resolve({
						message: `${script} completed`,
					});
				}
				reject(`Running '${script}' failed with code ${code}`);
			});
		});
	}
}
