import type { ChildProcess } from "node:child_process";
import { injectable } from "@decohere/crucible/decorators";
import { getPackageScriptCommand, startPackageScript } from "@decohere/devkit/interop";
import { type Logger, scribe } from "@decohere/scribe";

export type DeferredScriptStart = {
	readonly label: string;
	readonly cwd: string;
	readonly script: string;
	/** Workspace root used to detect pnpm/npm/yarn. */
	readonly workspaceRoot: string;
};

/** How long a script gets to stop after SIGTERM before it's killed. */
const STOP_TIMEOUT_MS = 2_000;
/** Windows has no process groups. There, only the package manager itself gets the signal. */
const USE_PROCESS_GROUP = process.platform !== "win32";

/** Signal the script's whole group: the package manager exits without stopping what it started. */
function signal(child: ChildProcess, name: NodeJS.Signals): void {
	if (!USE_PROCESS_GROUP || child.pid == null) {
		child.kill(name);
		return;
	}
	try {
		process.kill(-child.pid, name);
	} catch (error) {
		// The whole group has already gone, which is what we wanted.
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

/** Resolves true once the package manager has exited, or false if it hasn't within `ms`. */
function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
	if (child.exitCode != null || child.signalCode != null) return Promise.resolve(true);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), ms);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

/**
 * Nixpacks-style child processes for foreign packages in a flux serve slice.
 * Stopped when the Flux container disposes (SIGINT → RootModule teardown).
 */
@injectable()
export class DeferredScriptRunner implements AsyncDisposable {
	private readonly logger: Logger = scribe.logger(DeferredScriptRunner.name);
	private readonly children: ChildProcess[] = [];

	public start(options: DeferredScriptStart): ChildProcess {
		const { command, args } = getPackageScriptCommand(options);
		this.logger.info(
			`deferred ${options.label} — running ${command} ${args.join(" ")} in ${options.cwd}`,
		);
		const child = startPackageScript(options, {
			// Its own process group, so stopping it reaches what the package manager started. A
			// process in another group can't read the terminal, so it gets no stdin.
			stdio: USE_PROCESS_GROUP ? ["ignore", "inherit", "inherit"] : "inherit",
			detached: USE_PROCESS_GROUP,
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
		const children = this.children.splice(0);
		await Promise.all(
			children.map(async (child) => {
				signal(child, "SIGTERM");
				if (!(await waitForExit(child, STOP_TIMEOUT_MS))) signal(child, "SIGKILL");
			}),
		);
	}
}
