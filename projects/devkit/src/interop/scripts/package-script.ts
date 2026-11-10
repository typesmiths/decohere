import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import path from "node:path";
import {
	detectPackageManager,
	packageManagerFromString,
} from "../types/detect-package-manager.js";

export type PackageScript = {
	/** The folder whose `package.json` declares the script. */
	readonly cwd: string;
	readonly script: string;
	/** The workspace root, whose lockfile says which package manager runs the script. */
	readonly workspaceRoot: string;
};

/** `pnpm run build`: the package manager the workspace uses (pnpm when it can't tell). */
export function packageScriptCommand(options: PackageScript): {
	command: string;
	args: string[];
} {
	const pm = detectPackageManager(options.workspaceRoot) ?? packageManagerFromString("pnpm");
	return { command: pm.name, args: ["run", options.script] };
}

/**
 * `PATH` with the `node_modules/.bin` of the script's folder and each folder above it, up to the
 * workspace root, in front. A Decohere workspace installs once, at its root, and pnpm looks only
 * in the project's own `node_modules/.bin` unless it's a pnpm workspace, so a project's builder
 * (`astro`, `vite`) would otherwise not be found.
 */
export function packageScriptPath(
	options: PackageScript,
	current = process.env.PATH ?? "",
): string {
	const root = path.resolve(options.workspaceRoot);
	const bins: string[] = [];
	for (let dir = path.resolve(options.cwd); ; dir = path.dirname(dir)) {
		bins.push(path.join(dir, "node_modules", ".bin"));
		if (dir === root || path.dirname(dir) === dir) break;
	}
	return [...bins, current].filter((entry) => entry !== "").join(path.delimiter);
}

/** Start a package script and return its process: for scripts that run until stopped (`dev`). */
export function startPackageScript(
	options: PackageScript,
	spawnOptions: SpawnOptions = {},
): ChildProcess {
	const { command, args } = packageScriptCommand(options);
	const env = spawnOptions.env ?? process.env;
	return spawn(command, args, {
		stdio: "inherit",
		shell: false,
		...spawnOptions,
		env: { ...env, PATH: packageScriptPath(options, env.PATH) },
		cwd: options.cwd,
	});
}

/**
 * Run a package script to the end, its output on this process's, and resolve its exit code (1 when
 * a signal stopped it). Rejects when the package manager can't be started at all.
 */
export function runPackageScript(options: PackageScript): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = startPackageScript(options);
		child.once("error", reject);
		child.once("close", (code) => resolve(code ?? 1));
	});
}
