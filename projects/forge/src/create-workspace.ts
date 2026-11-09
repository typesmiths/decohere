import path from "node:path";
import { WORKSPACE_CONFIG, type Workspace, WorkspaceFactory } from "@decohere/workspace";
import type { WorkspaceFactoryOptions } from "@decohere/devkit/cli";
import { WorkspaceDefaults } from "./workspace.config.js";

/**
 * The workspace every Decohere tool sees (forge, the flux CLI and `flux.run`): forge's
 * defaults, the user's `.decohere.js`, and the root: `--root-dir`, else the current folder.
 */
export async function createWorkspace(
	options: WorkspaceFactoryOptions = {},
): Promise<Workspace> {
	const rootDir = options.rootDir ?? WorkspaceDefaults.rootDir ?? "./";
	const configFile =
		options.configFile ??
		(rootDir === WorkspaceDefaults.rootDir ? undefined : path.join(rootDir, WORKSPACE_CONFIG));
	// Forge's defaults go under the user's file, not over it, so `.decohere.js` can change any of
	// them. Its `configurations` replace forge's debug, link and release; its `ignoreProjects` add.
	return WorkspaceFactory.create({ configFile, rootDir }, { ...WorkspaceDefaults, rootDir });
}
