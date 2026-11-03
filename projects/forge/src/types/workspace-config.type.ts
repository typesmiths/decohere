import type {
	ProjectOptions as BaseProjectOptions,
	WorkspaceOptions as BaseWorkspaceOptions,
} from "@decohere/workspace";
import type { Action, CommandType } from "@decohere/devkit/cli";
import type { Constructable } from "@decohere/core/reflection";
import type { ForgeConfiguration } from "./configuration.type.js";

export type ProjectOptions = Omit<BaseProjectOptions, "configurations"> & {
	configurations: ForgeConfiguration[];
};

export type WorkspaceOptions = Omit<BaseWorkspaceOptions, "configurations" | "projects"> & {
	configurations: ForgeConfiguration[];
	projects?: Record<string, Partial<ProjectOptions>>;
	actions?: Record<string, Constructable<Action>>;
	commands?: Record<string, CommandType>;
};
