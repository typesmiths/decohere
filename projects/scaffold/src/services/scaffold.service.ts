import type { WorkspaceScaffold } from "../models/project.model.js";

/**
 * A feature has three responsibilities:
 *  1. `getOptions` — resolve provider selection and any follow-up questions.
 *     Receives the options collected so far; returns only the keys it owns.
 *     Short-circuits if the caller already supplied those keys via CLI flags.
 *  2. `scaffold` — mutate the workspace models and/or write files using the
 *     fully-resolved options. Called after ALL features have gathered options
 *     but BEFORE files are written to disk.
 *  3. `finalize` (optional) — run post-write actions (e.g. install dependencies).
 *     Called after workspace.scaffold() has flushed all files to disk.
 */
export interface Feature<TOptions extends object = object> {
	getOptions(
		workspace: WorkspaceScaffold,
		cliOptions: Partial<TOptions>,
	): Promise<Partial<TOptions>>;
	scaffold(workspace: WorkspaceScaffold, options: TOptions): Promise<void> | void;
	finalize?(workspace: WorkspaceScaffold, options: TOptions): Promise<void> | void;
}

async function scaffold(
	workspace: WorkspaceScaffold,
	cliOptions: object,
	features: Feature[],
) {
	const options = await getAllOptions(workspace, cliOptions, features);
	// Features mutate workspace models first, then workspace renders to disk.
	await scaffoldFeatures(workspace, options, features);
	await scaffoldWorkspace(workspace, options);
	// Post-write phase: install deps, print final messages, etc.
	await finalizeFeatures(workspace, options, features);
}

async function scaffoldWorkspace(workspace: WorkspaceScaffold, _options: object) {
	await workspace.scaffold();
}

/**
 * Iterate features in order, calling `getOptions` on each.
 * Each feature receives the running merged options so later features can
 * branch on decisions made by earlier ones (e.g. database choice affects auth).
 * Results are shallow-merged, so features only need to return what they own.
 */
async function getAllOptions(
	workspace: WorkspaceScaffold,
	cliOptions: object,
	features: Feature[],
): Promise<object> {
	let options = { ...cliOptions };
	for (const feature of features) {
		const featureOptions = await feature.getOptions(workspace, options);
		options = { ...options, ...featureOptions };
	}
	return options;
}

/**
 * Iterate features in order, calling `scaffold` with the fully-resolved options.
 * All option-gathering is complete before any scaffolding begins.
 */
async function scaffoldFeatures(
	workspace: WorkspaceScaffold,
	options: object,
	features: Feature[],
): Promise<void> {
	for (const feature of features) {
		await feature.scaffold(workspace, options as never);
	}
}

/**
 * Iterate features in order, calling `finalize` on each (if defined).
 * All files are on disk by this point.
 */
async function finalizeFeatures(
	workspace: WorkspaceScaffold,
	options: object,
	features: Feature[],
): Promise<void> {
	for (const feature of features) {
		if (feature.finalize) {
			await feature.finalize(workspace, options as never);
		}
	}
}

export const ScaffoldService = { scaffold };
