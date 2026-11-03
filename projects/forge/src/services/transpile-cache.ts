import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { version as swcVersion } from "@swc/core";

/**
 * Where compiled code is cached on disk, or null when caching is off:
 *
 * - `DECOHERE_CACHE=0` turns it off.
 * - `DECOHERE_CACHE_DIR` puts it in that directory.
 * - Otherwise `<root>/node_modules/.cache/decohere`, where tools keep caches, or when the
 *   workspace has no `node_modules`, `$XDG_CACHE_HOME/decohere`, then the OS temp directory.
 *
 * Flux keeps its entries in the `flux` folder inside it; `forge clean` removes the folder.
 */
function directory(rootDir: string, env: NodeJS.ProcessEnv = process.env): string | null {
	if (env.DECOHERE_CACHE === "0") return null;
	if (env.DECOHERE_CACHE_DIR != null && env.DECOHERE_CACHE_DIR !== "") {
		return path.resolve(env.DECOHERE_CACHE_DIR);
	}
	const nodeModules = path.join(rootDir, "node_modules");
	if (existsSync(nodeModules)) return path.join(nodeModules, ".cache", "decohere");
	if (env.XDG_CACHE_HOME != null && env.XDG_CACHE_HOME !== "") {
		return path.join(env.XDG_CACHE_HOME, "decohere");
	}
	return path.join(os.tmpdir(), "decohere");
}

/** The SWC version compiling: part of every cache key, so upgrading SWC misses. */
export const transpileCache = { directory, swcVersion };
