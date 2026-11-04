import path from "node:path";
import { UserConfigFactory, WORKSPACE_CONFIG } from "@decohere/workspace";
import type { Actions, ApplicationModule, ModuleManifest } from "@decohere/devkit/cli";
import { CommandResponse, DecohereCommand } from "@decohere/devkit/cli";
import { Trace } from "@decohere/devkit/diagnostics";
import type { Constructable } from "@decohere/core/reflection";
import type { Command } from "commander";
import { CommanderError } from "commander";
import { ModuleFactory } from "./module.factory.js";
import { RootCommand } from "./root.command.js";

@Trace
export class RootModule {
	public static async create(
		moduleTypes: readonly Constructable<ModuleManifest>[],
		options?: { configFile?: string; logLevel?: string; rootDir?: string },
	): Promise<RootModule> {
		// With --root-dir, the root's .decohere.js, not the current folder's.
		const configFile =
			options?.configFile ??
			(options?.rootDir ? path.join(options.rootDir, WORKSPACE_CONFIG) : undefined);
		const userConfig = await UserConfigFactory.getUserConfig(configFile);
		return new RootModule(moduleTypes, {
			...userConfig,
			configFile,
			rootDir: options?.rootDir,
		});
	}

	readonly #command: RootCommand;
	readonly #modules: ApplicationModule[];
	#lastResponse: CommandResponse = {};
	#stop?: StopSignal;

	private constructor(
		manifestClasses: readonly Constructable<ModuleManifest>[],
		config: Record<string, unknown>,
	) {
		const modules = manifestClasses.map((ManifestClass) => {
			const manifest = new ManifestClass();
			return ModuleFactory.create(manifest, this.onResponse, config);
		});

		this.#modules = modules;
		this.#command = new RootCommand(
			modules,
			config.configFile as string | undefined,
			config.rootDir as string | undefined,
		);
		// Before the command runs, not after it returns: a stop signal while `flux serve` boots
		// (`docker stop` during start-up) is held for the shutdown below instead of killing the
		// process before anything is disposed.
		this.#command.hook("preAction", (_root, actionCommand) => {
			if (
				actionCommand instanceof DecohereCommand &&
				actionCommand.runsUntilStopped(actionCommand.opts())
			) {
				this.#stop ??= stopSignal();
			}
		});
	}

	private onResponse = (_moduleId: string, response: CommandResponse) => {
		this.#lastResponse = response;
	};

	public async run<TActions extends Actions>(
		argv?: string[],
	): Promise<CommandResponse<TActions>> {
		try {
			await this.#command.parseAsync(argv, argv ? { from: "user" } : undefined);
			if (this.isBlocking(this.#lastResponse)) {
				this.#stop ??= stopSignal();
				await this.#stop.received;
			}
			return this.#lastResponse as CommandResponse<TActions>;
		} catch (error) {
			if (this.isCommanderHelpOrVersion(error)) {
				return CommandResponse.help<TActions>();
			}

			throw error;
		} finally {
			this.#stop?.dispose();
			this.#stop = undefined;
			await this[Symbol.asyncDispose]();
		}
	}

	public get commands(): Command[] {
		return this.#command.commands as Command[];
	}

	public [Symbol.dispose]() {
		for (const mod of this.#modules) {
			mod.dispose?.();
		}
	}

	public async [Symbol.asyncDispose]() {
		for (const mod of this.#modules) {
			await mod.asyncDispose?.();
		}
	}

	private isBlocking(response: CommandResponse): boolean {
		return Object.values(response).some((r) => r?.blocking === true);
	}

	private isCommanderHelpOrVersion(error: unknown): boolean {
		const isCommanderError = error instanceof CommanderError;
		const helpCodes = ["commander.helpDisplayed", "commander.version", "commander.help"];
		return isCommanderError && helpCodes.includes(error.code);
	}
}

/**
 * `received` resolves on Ctrl+C (SIGINT) or SIGTERM (Docker, CI, process managers), so
 * long-running commands like `flux serve` shut down cleanly either way. While listening,
 * the signal no longer kills the process; `dispose()` stops listening and restores that.
 */
type StopSignal = { received: Promise<void>; dispose(): void };

function stopSignal(): StopSignal {
	let onSignal = () => {};
	const received = new Promise<void>((resolve) => {
		onSignal = resolve;
	});
	const stop = () => {
		dispose();
		onSignal();
	};
	const dispose = () => {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	return { received, dispose };
}
