import type { ContainerBuilder } from "@decohere/core/composition";
import type { ActionClassMap } from "./action.js";
import type { CommandType, DecohereCommand } from "./command.js";

export type CommandMap = Record<string, CommandType>;

export type WorkspaceFactoryOptions = {
	configFile?: string;
	rootDir?: string;
};

export interface ApplicationModule {
	id: string;
	dispose?(): void;
	asyncDispose?(): Promise<void>;
	command: DecohereCommand;
}

export type ModuleConfig = {
	actions?: ActionClassMap;
	commands?: CommandMap;
};

/**
 * Simple declaration interface for a CLI module.
 * Extend this and implement the four abstract members.
 */
export abstract class ModuleManifest {
	/** Unique module identifier, used as the root command name. */
	public abstract readonly id: string;

	/** Sub-command classes this module contributes. */
	public readonly commands: CommandMap = {};

	/** Action classes this module contributes. */
	public readonly actions: ActionClassMap = {};

	/** The root command class for this module. */
	public abstract readonly command: CommandType;

	/** Register infrastructure services into the DI container. */
	public registerServices(_builder: ContainerBuilder): void {}

	/** Lazily create a workspace instance. Return null if this module does not use a workspace. */
	public createWorkspace(_options: WorkspaceFactoryOptions): Promise<object | null> {
		return Promise.resolve(null);
	}
}
