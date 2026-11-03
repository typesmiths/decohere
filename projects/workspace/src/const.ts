export const TS_CONFIG = "tsconfig.json";
export const PACKAGE_JSON = "package.json";
export const NODE_MODULES = "node_modules";
export const FIXTURES = "__fixtures__";
export const WORKSPACE_CONFIG = ".decohere.js";
export const PROJECTS_DIR = "projects";

import type { WorkspaceOptions } from "./models/workspace-config.type.js";

export const WorkspaceDefaults: WorkspaceOptions = {
	rootDir: "./",
	outDir: "dist",
	includeProjects: [`${PROJECTS_DIR}/**/${PACKAGE_JSON}`],
	ignoreProjects: [`**/${NODE_MODULES}/**`, `**/${FIXTURES}/**`, "**/dist/**"],
	include: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
	ignore: ["**/*.d.ts", "**/*.d.mts", "**/*.d.cts", `**/${NODE_MODULES}/**`],
	copyFiles: [],
	configurations: [{ name: "debug" }],
};
