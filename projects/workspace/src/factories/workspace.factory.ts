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

class Factory {
	public async create(options: WorkspaceFactoryOptions & Partial<WorkspaceOptions> = {}) {
		const config = await this.getMergedConfig(options);
		const projectSeeds = await ProjectFactory.getProjectSeeds(config);
		const packageJson = await this.getPackageJson(config.rootDir ?? "./");
		const workspace = new Workspace({ packageJson, config, projects: projectSeeds });
		return workspace;
	}

	private async getMergedConfig(
		options: WorkspaceFactoryOptions & Partial<WorkspaceOptions>,
	): Promise<WorkspaceOptions> {
		const { configFile, ...rest } = options;
		const userConfig = await UserConfigFactory.getUserConfig(configFile);
		return merge.withOptions<WorkspaceOptions>(
			{ mergeArrays: false },
			WorkspaceDefaults,
			userConfig,
			rest,
		) as WorkspaceOptions;
	}

	private async getPackageJson(rootDir: string) {
		const packageJsonPath = path.join(rootDir, PACKAGE_JSON);
		if (!(await io.fileExists(packageJsonPath))) return;
		const data = await io.readJsonFile<Partial<PackageJson>>(packageJsonPath);
		return new PackageJson(data);
	}
}

export const WorkspaceFactory = new Factory();
