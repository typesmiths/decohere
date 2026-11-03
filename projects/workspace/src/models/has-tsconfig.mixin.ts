import fs from "node:fs";
import path from "node:path";
import { memoize } from "@decohere/core/caching";
import { io } from "@decohere/core/io";
import { TS_CONFIG } from "../const.js";
import { Tsconfig } from "./tsconfig.model.js";

export abstract class HasTsConfig {
	protected abstract get tsConfigDirectory(): string;
	protected abstract get fallbackTsConfigDirectory(): string | undefined;

	@memoize()
	public async getTsConfig() {
		for (const configPath of this.tsConfigPaths) {
			if (await io.fileExists(configPath)) return Tsconfig.parse(configPath);
		}
		return Tsconfig.default();
	}

	@memoize()
	public getTsConfigSync() {
		const configPath = this.findTsConfigPath();
		if (configPath != null) return Tsconfig.parseSync(configPath);
		return Tsconfig.default();
	}

	/** First existing `tsconfig.json` on this object, if any. */
	protected findTsConfigPath(): string | undefined {
		return this.tsConfigPaths.find((configPath) => HasTsConfig.fileExistsSync(configPath));
	}

	private get tsConfigPaths(): string[] {
		const paths = [path.join(this.tsConfigDirectory, TS_CONFIG)];
		const fallback = this.fallbackTsConfigDirectory;
		if (fallback != null) {
			paths.push(path.join(fallback, TS_CONFIG));
		}
		return paths;
	}

	private static fileExistsSync(filePath: string): boolean {
		try {
			return fs.statSync(filePath).isFile();
		} catch {
			return false;
		}
	}
}
