import { WorkspaceDefaults as BaseDefaults } from "@decohere/workspace";
import { BuildTargets } from "./types/build-target.type.js";
import type { ForgeConfiguration } from "./types/configuration.type.js";
import type { WorkspaceOptions } from "./types/workspace-config.type.js";

export const Debug: ForgeConfiguration = {
	name: "debug",
	targets: [BuildTargets.es6],
	aliasPaths: true,
	// Fixtures are runtime inputs (often raw .ts / configs), not library sources.
	ignore: ["**/__fixtures__/**"],
	copyFiles: ["**/__fixtures__/**", "**/.decohere.js", "**/.decohere.*.js"],
};

export const Release: ForgeConfiguration = {
	name: "release",
	pack: true,
	targets: [BuildTargets.es6, BuildTargets.types],
	// Published output: no inline maps (they carry full source and build-machine paths).
	sourceMaps: false,
	// Tests and benchmarks are not shipped: they import dev-only packages (vitest, @swc/core).
	ignore: ["**/*.spec.ts", "**/*.test.ts", "**/*.bench.ts", "tests/**", "e2e/**", "bench/**"],
	// A configuration's copyFiles sit next to the emitted JS under es6/ and types/ (for
	// import.meta.url). A repo's own files go in its .decohere.js, not in these defaults.
};

/**
 * Link configuration: unpacked JS + co-located type declarations.
 * Intended for `forge link` — symlinked into a consumer's node_modules so that
 * both runtime resolution and TypeScript find the same output directory.
 */
export const Link: ForgeConfiguration = {
	name: "link",
	pack: true,
	targets: [BuildTargets.es6, BuildTargets.types],
};

export const DefaultConfigurations = [Debug, Link, Release];

export const WorkspaceDefaults: WorkspaceOptions = {
	...BaseDefaults,
	// Root-only files npm ships with the package. Globs that match nothing are fine.
	copyFiles: ["package.json", "README.md", "LICENSE*", "**/*.mjs"],
	configurations: DefaultConfigurations,
	projects: undefined,
};
