import path from "node:path";
import {
	UserConfigFactory,
	WORKSPACE_CONFIG,
	type Workspace,
	WorkspaceFactory,
} from "@decohere/workspace";
import type { WorkspaceFactoryOptions } from "@decohere/devkit/cli";
import { DefaultConfigurations, WorkspaceDefaults } from "./workspace.config.js";

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
	// `projects` is dropped too: forge's defaults set it to undefined, which would override the
	// user's per-project settings (docker, ui) in the merge.
	const { configurations: _, projects: __, ...forgeDefaults } = WorkspaceDefaults;
	const userConfig = await UserConfigFactory.getUserConfig(configFile);
	// Only apply forge default configurations when user config doesn't provide any.
	// This ensures user-defined configurations take priority while still providing
	// sensible defaults (debug + release) when no config file is present.
	const configurations = userConfig.configurations?.length ? undefined : DefaultConfigurations;
	return WorkspaceFactory.create({
		...forgeDefaults,
		...(configurations ? { configurations } : {}),
		configFile,
		rootDir,
	});
}
