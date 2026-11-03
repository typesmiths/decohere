import fs from "node:fs";
import path from "node:path";
import { Project } from "@decohere/workspace";
import { memoize } from "@decohere/core/caching";
import { extension } from "@decohere/core/extensibility";
import { io } from "@decohere/core/io";
import { SWC_CONFIG } from "../const.js";
import type { ForgeConfiguration } from "../types/configuration.type.js";
import { SwcConfig } from "../types/swc-config.type.js";

declare module "@decohere/workspace" {
	interface Project {
		getForgeConfiguration(): ForgeConfiguration;
		getSwcConfig(): Promise<SwcConfig>;
		getSwcConfigSync(): SwcConfig;
	}
}

export class ProjectExtensions {
	@extension(Project)
	public static getForgeConfiguration(project: Project): ForgeConfiguration {
		return project.configuration as ForgeConfiguration;
	}

	@extension(Project)
	@memoize()
	public static async getSwcConfig(project: Project): Promise<SwcConfig> {
		for (const configPath of ProjectExtensions.swcConfigPaths(project)) {
			if (await io.fileExists(configPath)) {
				return new SwcConfig(await io.readJsonFile(configPath));
			}
		}
		return new SwcConfig();
	}

	@extension(Project)
	@memoize()
	public static getSwcConfigSync(project: Project): SwcConfig {
		for (const configPath of ProjectExtensions.swcConfigPaths(project)) {
			if (ProjectExtensions.fileExistsSync(configPath)) {
				return new SwcConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
			}
		}
		return new SwcConfig();
	}

	private static swcConfigPaths(project: Project): string[] {
		return [
			path.join(project.projectRoot, SWC_CONFIG),
			path.join(project.rootDir, SWC_CONFIG),
		];
	}

	private static fileExistsSync(filePath: string): boolean {
		try {
			return fs.statSync(filePath).isFile();
		} catch {
			return false;
		}
	}
}
