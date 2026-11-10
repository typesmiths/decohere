import path from "node:path";
import { getPackageScriptCommand, runPackageScript } from "@decohere/devkit/interop";
import type { Logger } from "@decohere/scribe";
import type { Project } from "@decohere/workspace";
import { ForgeError } from "../errors.js";

/**
 * Run each project's own script for a step (`build`, `check`) in its folder, one after another,
 * logging `<verb> <project> with its own <script> script (pnpm run <script>)`. A script that fails
 * fails the step.
 */
export async function runOwnScripts(
	projects: readonly Project[],
	options: { script: string; verb: string; workspaceRoot: string; logger: Logger },
): Promise<void> {
	const workspaceRoot = path.resolve(options.workspaceRoot);
	for (const project of projects) {
		const script = { cwd: project.projectRoot, script: options.script, workspaceRoot };
		const { command, args } = getPackageScriptCommand(script);
		const run = `${command} ${args.join(" ")}`;
		options.logger.info(
			`${options.verb} ${project.name} with its own ${options.script} script (${run})`,
		);
		const code = await runPackageScript(script);
		if (code !== 0) {
			throw new ForgeError(
				`${project.name}'s ${options.script} script failed (${run} exited with ${code})`,
			);
		}
	}
}
