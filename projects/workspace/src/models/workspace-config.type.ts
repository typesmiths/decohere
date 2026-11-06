/**
 * Generic configuration for a workspace build profile.
 * Concrete tools (e.g. @decohere/forge) extend this with tool-specific fields.
 */
export type Configuration = {
	name: string;
	include?: string[];
	ignore?: string[];
	/** Extra globs to copy into the configuration outDir (non-transpiled assets). */
	copyFiles?: string[];
	/** If true, the output is packed into a folder per project directory. */
	pack?: boolean;
};

export type DockerConfig = {
	image?: string;
	dockerfile?: string;
	buildArgs?: Record<string, string>;
	secrets?: Record<string, string>;
	tags?: string[];
	push?: boolean;
};

/**
 * The UI a deployable serves from its API (`statics` in `@decohere/http`). `forge package` copies the
 * UI project's build output into the deployable's `.package/` folder.
 */
export type UiConfig = {
	/** Package name of the UI project, e.g. `@app/shop.web`. */
	project: string;
	/** The UI project's build output folder, relative to that project. Defaults to `dist`. */
	output?: string;
	/** Where it lands inside `.package/`, which is also the folder the API serves. Defaults to `ui`. */
	to?: string;
};

export type WorkspaceFactoryOptions = {
	rootDir?: string;
	configFile?: string;
};

export type ProjectOptions = {
	include?: string[];
	ignore?: string[];
	copyFiles: string[];
	configurations: Configuration[];
	docker?: DockerConfig;
	ui?: UiConfig;
};

export type WorkspaceOptions = {
	rootDir?: string;
	outDir: string;
	includeProjects: string[];
	ignoreProjects: string[];
	projects?: Record<string, Partial<ProjectOptions>>;
} & ProjectOptions;
