import path from "node:path";
import {
	findWorkspaceRoot,
	UserConfigFactory,
	WORKSPACE_CONFIG,
	type Workspace,
	WorkspaceFactory,
} from "@decohere/workspace";
import type { WorkspaceFactoryOptions } from "@decohere/devkit/cli";
import { DefaultConfigurations, WorkspaceDefaults } from "./workspace.config.js";

/**
 * The workspace every Decohere tool sees (forge, the flux CLI and `flux.run`): forge's
 * defaults, the user's `.decohere.js`, and a root found by searching upward from cwd.
 */
export async function createWorkspace(
	options: WorkspaceFactoryOptions = {},
): Promise<Workspace> {
	const rootDir = options.rootDir ?? defaultRootDir();
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

/** `./` when cwd is the root (keeps paths relative as before), else the root above it. */
function defaultRootDir(): string {
	const root = findWorkspaceRoot(process.cwd());
	return root === process.cwd() ? (WorkspaceDefaults.rootDir ?? "./") : root;
}
