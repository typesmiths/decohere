import type { Configuration } from "@decohere/workspace";
import type { BuildTarget } from "./build-target.type.js";

export type ForgeConfiguration = Configuration & {
	targets: BuildTarget[];
	aliasPaths?: boolean;
	/**
	 * Inline source maps in emitted JavaScript (default true). They embed the full TypeScript
	 * source and absolute build paths, so published (release) output turns them off.
	 */
	sourceMaps?: boolean;
};
