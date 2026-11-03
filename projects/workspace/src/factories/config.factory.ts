import path from "node:path";
import { pathToFileURL } from "node:url";
import { cache } from "@decohere/core/caching";
import { io } from "@decohere/core/io";
import { WORKSPACE_CONFIG } from "../const.js";
import type { WorkspaceOptions } from "../models/workspace-config.type.js";

class ConfigFactory {
	@cache()
	public async getUserConfig(configFile?: string): Promise<Partial<WorkspaceOptions>> {
		const file = configFile ?? WORKSPACE_CONFIG;
		if (!file || !(await io.fileExists(file))) {
			return {} as WorkspaceOptions;
		}
		const fileUrl = pathToFileURL(path.resolve(file)).href;
		const conf = (await import(fileUrl)).default as Partial<WorkspaceOptions>;
		return conf;
	}
}

export const UserConfigFactory = new ConfigFactory();
