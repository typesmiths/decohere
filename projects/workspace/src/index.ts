export { WORKSPACE_CONFIG, WorkspaceDefaults } from "./const.js";
export { WorkspaceConfigurationError } from "./errors.js";
export { UserConfigFactory } from "./factories/config.factory.js";
export { ProjectFactory } from "./factories/project.factory.js";
export { WorkspaceFactory } from "./factories/workspace.factory.js";
export { HasPackageJson } from "./models/has-package-json.mixin.js";
export { HasTsConfig } from "./models/has-tsconfig.mixin.js";
export { type PackageAliases, packageAliases } from "./models/package-aliases.js";
export type { PackageExports, RepositoryReference } from "./models/package-json.model.js";
export { PackageJson } from "./models/package-json.model.js";
export type { ProjectConfig, ProjectSeed } from "./models/project.model.js";
export { Project } from "./models/project.model.js";
export { projectScripts } from "./models/project-scripts.js";
export { sourceExtensions } from "./models/source-extensions.js";
export type { ProjectFileEvent } from "./models/project-file-event.js";
export type { CompilerOptions } from "./models/tsconfig.model.js";
export { DEFAULT_COMPILER_OPTIONS, Tsconfig } from "./models/tsconfig.model.js";
export { Workspace } from "./models/workspace.model.js";
export type {
	Configuration,
	ProjectOptions,
	UiConfig,
	WorkspaceFactoryOptions,
	WorkspaceOptions,
} from "./models/workspace-config.type.js";
