import type { Project, Tsconfig, Workspace } from "@decohere/workspace";

export type SwcConfigOptions = {
	aliasPaths?: boolean;
	/** `false` drops source maps from the output. */
	sourceMaps?: boolean;
	tsConfig?: Tsconfig;
	userConfig?: SwcConfig;
	/** When set, convention aliases come from the full workspace package list. */
	workspace?: Workspace;
	/** Fallback package list when `workspace` is not set (e.g. a transform batch). */
	projects?: readonly Project[];
};

export class SwcConfig {
	public constructor(data: Partial<SwcConfig> = {}) {
		Object.assign(this, data);
	}
}
