import path from "node:path";
import type { Workspace } from "@decohere/workspace";
import { HotReloadServer } from "./hot-reload-server.js";
import { SourceModuleLoader } from "./source-module-loader.js";

export type FluxRunOptions = {
	/** Workspace configuration name. Defaults to `debug` (`--configuration`). */
	configuration?: string;
	/** Arguments forwarded to the entry (bin-style `process.argv.slice(2)`). */
	args?: string[];
	/**
	 * Pre-built Workspace instead of `WorkspaceFactory`.
	 * Useful in tests to skip filesystem discovery.
	 */
	workspace?: Workspace;
};

export type FluxServeOptions = {
	/** Workspace configuration name. Defaults to `debug` (`--configuration`). */
	configuration?: string;
	/** Name of the project to serve. Defaults to the first project in the workspace. */
	project?: string;
	/**
	 * Multiple Flux app package names to boot in one process (directory slice).
	 * When set, takes precedence over {@link project}.
	 */
	projects?: readonly string[];
	/**
	 * Pre-built Workspace instead of `WorkspaceFactory`.
	 * Useful in tests to skip filesystem discovery.
	 */
	workspace?: Workspace;
	/**
	 * Quiet window in milliseconds after the last affecting save before a reboot.
	 * Raise this for agent save trains.
	 */
	rebootDebounceMs?: number;
};

/** Process-level one-shot loader so a second `run()` reconfigures instead of stacking hooks. */
const runLoader = new SourceModuleLoader();

async function run(entry: string, options: FluxRunOptions = {}): Promise<unknown> {
	const trimmed = entry.trim();
	if (trimmed == null || trimmed === "") {
		throw new Error("flux.run requires an entry file path");
	}

	const absoluteEntry = path.resolve(trimmed);
	await runLoader.configure({
		workspace: options.workspace,
		buildConfig: options.configuration ?? "debug",
	});
	runLoader.registerHooks();
	process.argv = [process.execPath, absoluteEntry, ...(options.args ?? [])];
	return runLoader.importEntry(absoluteEntry);
}

async function serve(options: FluxServeOptions = {}): Promise<HotReloadServer> {
	const server = new HotReloadServer();
	await server.start({
		buildConfig: options.configuration ?? "debug",
		project: options.project,
		projects: options.projects,
		workspace: options.workspace,
		rebootDebounceMs: options.rebootDebounceMs,
	});
	return server;
}

function dispose(): void {
	runLoader.dispose();
}

export const flux = { run, serve, dispose };
