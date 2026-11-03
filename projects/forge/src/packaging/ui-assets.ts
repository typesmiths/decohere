import path from "node:path";
import type { Project } from "@decohere/workspace";
import { io } from "@decohere/core/io";
import { ForgeError } from "../errors.js";

export const DEFAULT_UI_OUTPUT = "dist";
export const DEFAULT_UI_TARGET = "ui";

/** Folders `forge package` writes itself; a UI cannot land on top of them. */
const RESERVED_TARGETS = new Set(["es6", "node_modules", "config", "package.json"]);

export type UiAssets = {
	/** The UI project's name. */
	project: string;
	/** Absolute path of the built UI. */
	from: string;
	/** Folder name inside `.package/`. */
	to: string;
};

/**
 * What the deployable's `ui` declaration (`.decohere.js`) asks for, checked before anything
 * is written: the UI project exists and has been built. Forge does not build it (see ADR 0007).
 * Returns `undefined` when the deployable declares no UI.
 */
async function resolve(
	deployable: Project,
	projects: readonly Project[],
): Promise<UiAssets | undefined> {
	const ui = deployable.uiConfig;
	if (ui == null) {
		return undefined;
	}

	const to = path.normalize(ui.to ?? DEFAULT_UI_TARGET);
	const output = ui.output ?? DEFAULT_UI_OUTPUT;
	if (path.isAbsolute(to) || to.split(path.sep).includes("..") || to === ".") {
		throw new ForgeError(
			`ui.to of ${deployable.name} must be a folder inside .package/, but is "${ui.to}".`,
		);
	}
	if (RESERVED_TARGETS.has(to.split(path.sep)[0] as string)) {
		throw new ForgeError(
			`ui.to of ${deployable.name} is "${ui.to}", which forge package uses for something else.`,
		);
	}

	const uiProject = projects.find((candidate) => candidate.name === ui.project);
	if (uiProject == null) {
		throw new ForgeError(
			`${deployable.name} declares the UI project ${ui.project}, which is not a workspace project. ` +
				`Known projects: ${projects.map((p) => p.name).join(", ")}`,
		);
	}

	const root = path.resolve(uiProject.projectRoot);
	const from = path.resolve(root, output);
	if (!from.startsWith(root + path.sep)) {
		throw new ForgeError(`ui.output of ${deployable.name} must stay inside ${ui.project}.`);
	}
	if (!(await io.directoryExists(from))) {
		throw new ForgeError(
			`${deployable.name} declares the UI project ${ui.project}, but it has no build output at ${from}. ` +
				"Build the UI first (forge does not build it), or set ui.output if it builds somewhere else.",
		);
	}
	return { project: ui.project, from, to };
}

export const uiAssets = { resolve };
