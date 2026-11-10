import path from "node:path";
import { io } from "@decohere/core/io";
import { merge } from "@decohere/core/objects";
import { PACKAGE_JSON, WorkspaceDefaults } from "../const.js";
import { PackageJson } from "../models/package-json.model.js";
import { Workspace } from "../models/workspace.model.js";
import type {
	WorkspaceFactoryOptions,
	WorkspaceOptions,
} from "../models/workspace-config.type.js";
import { UserConfigFactory } from "./config.factory.js";
import { ProjectFactory } from "./project.factory.js";

/** Patterns that leave things out: a user's list adds to the defaults', so they needn't restate them. */
const ADDITIVE = ["ignoreProjects", "ignore"] as const;

class Factory {
	/**
	 * The workspace from `defaults`, then the user's `.decohere.js`, then `options`, each over the
	 * one before. A tool passes its own defaults here, not in `options`, so the user's file can
	 * change them. Arrays replace the ones before them, except the ignore lists, which add up.
	 */
	public async create(
		options: WorkspaceFactoryOptions & Partial<WorkspaceOptions> = {},
		defaults: WorkspaceOptions = WorkspaceDefaults,
	) {
		const config = await this.getMergedConfig(options, defaults);
		const projectSeeds = await ProjectFactory.getProjectSeeds(config);
		const packageJson = await this.getPackageJson(config.rootDir ?? "./");
		const workspace = new Workspace({ packageJson, config, projects: projectSeeds });
		return workspace;
	}

	private async getMergedConfig(
		options: WorkspaceFactoryOptions & Partial<WorkspaceOptions>,
		defaults: WorkspaceOptions,
	): Promise<WorkspaceOptions> {
		const { configFile, ...rest } = options;
		const userConfig = await UserConfigFactory.getUserConfig(configFile);
		const config = merge.withOptions<WorkspaceOptions>(
			{ mergeArrays: false },
			defaults,
			userConfig,
			rest,
		) as WorkspaceOptions;
		for (const key of ADDITIVE) {
			const layers = [defaults[key], userConfig[key], rest[key]];
			config[key] = [...new Set(layers.flatMap((patterns) => patterns ?? []))];
		}
		return config;
	}

	private async getPackageJson(rootDir: string) {
		const packageJsonPath = path.join(rootDir, PACKAGE_JSON);
		if (!(await io.fileExists(packageJsonPath))) return;
		const data = await io.readJsonFile<Partial<PackageJson>>(packageJsonPath);
		return new PackageJson(data);
	}
}

export const WorkspaceFactory = new Factory();
