import { type ChildProcess, spawn } from "node:child_process";
import { injectable } from "@decohere/crucible/decorators";
import { detectPackageManager, packageManagerFromString } from "@decohere/devkit/interop";
import { type Logger, scribe } from "@decohere/scribe";

export type DeferredScriptStart = {
	readonly label: string;
	readonly cwd: string;
	readonly script: string;
	/** Workspace root used to detect pnpm/npm/yarn. */
	readonly workspaceRoot: string;
};

/**
 * Nixpacks-style child processes for foreign packages in a flux serve slice.
 * Killed when the Flux container disposes (SIGINT → RootModule teardown).
 */
@injectable()
export class DeferredScriptRunner implements AsyncDisposable {
	private readonly logger: Logger = scribe.logger(DeferredScriptRunner.name);
	private readonly children: ChildProcess[] = [];

	public start(options: DeferredScriptStart): ChildProcess {
		const pm = detectPackageManager(options.workspaceRoot) ?? packageManagerFromString("pnpm");
		this.logger.info(
			`deferred ${options.label} — running ${pm.name} run ${options.script} in ${options.cwd}`,
		);
		const child = spawn(pm.name, ["run", options.script], {
			cwd: options.cwd,
			stdio: "inherit",
			env: process.env,
			shell: false,
		});
		child.on("exit", (code, signal) => {
			if (signal) return;
			if (code != null && code !== 0) {
				this.logger.warn(`deferred ${options.label} exited with ${code}`);
			}
		});
		this.children.push(child);
		return child;
	}

	public async [Symbol.asyncDispose]() {
		for (const child of this.children) {
			if (!child.killed) {
				child.kill("SIGTERM");
			}
		}
		this.children.length = 0;
	}
}
