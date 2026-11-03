import { Command as CommanderType, type OptionValues } from "commander";
import type { Constructable } from "@decohere/core/reflection";
import type { ActionResponse, Actions } from "./action.js";

export type CommandType = Constructable<DecohereCommand>;

export type CommandHandler = (opts: OptionValues, cmd: DecohereCommand) => Promise<void>;

export type CommandResponse<TActions extends Actions = Actions> = {
	[ActionName in keyof TActions]?: ActionResponse;
};

export const CommandResponse = {
	success<T extends Actions>(
		_ctx: unknown,
		responses: CommandResponse<T>,
	): CommandResponse<T> {
		return responses;
	},

	help<T extends Actions = Actions>(): CommandResponse<T> {
		return {} as CommandResponse<T>;
	},

	fromAction(name: string, response: ActionResponse): CommandResponse {
		return { [name]: response };
	},
};

/** Thrown when a command execution fails due to action errors. */
export class CommandError extends Error {}

export class DecohereCommand<TActions extends Actions = Actions> extends CommanderType {
	public get actions(): readonly Constructable<import("./action.js").Action>[] {
		return [];
	}

	public constructor(
		name?: string | Constructable | Record<string, CommandType>,
		handler?: CommandHandler,
	) {
		super();
		if (typeof name === "string" || typeof name === "function") {
			this.name(this.parseCommandName(name));
		} else {
			this.name(this.parseCommandName(this.constructor as unknown as Constructable));
			if (name) {
				this.registerSubcommand(name, handler);
			}
		}
		if (handler && !this.commands.length) {
			this.action(handler);
		}
		this.exitOverride();
	}

	/**
	 * Whether the command, with these options, runs until it is stopped (`flux serve`,
	 * `forge build --watch`). The CLI then listens for SIGINT and SIGTERM from the moment it
	 * starts, so a stop during start-up still shuts down cleanly; other commands keep Node's
	 * default, where Ctrl+C ends them at once.
	 */
	public runsUntilStopped(_options: OptionValues): boolean {
		return false;
	}

	public async run(
		actions: TActions,
		options: OptionValues,
	): Promise<CommandResponse<TActions>> {
		const responses = await this.runActions(actions, options);
		this.throwOnErrors(responses);
		return CommandResponse.success(options, responses);
	}

	public registerSubcommand(command: CommandType, onAction?: CommandHandler): void;
	public registerSubcommand(
		commands: Record<string, DecohereCommand | CommandType>,
		onAction?: CommandHandler,
	): void;
	public registerSubcommand(
		commands: CommandType | Record<string, DecohereCommand | CommandType>,
		onAction?: CommandHandler,
	): void {
		if (typeof commands === "function") {
			const instance = new commands(commands, onAction);
			this.addCommand(instance);
			if (onAction && !instance.commands.length) {
				instance.action(onAction);
			}
			return;
		}

		for (const [key, command] of Object.entries(commands)) {
			const instance =
				command instanceof DecohereCommand ? command : new command(key, onAction);
			this.addCommand(instance);
			if (onAction && !instance.commands.length) {
				instance.action(onAction);
			}
		}
	}

	protected async runActions(
		actions: TActions,
		options: OptionValues,
	): Promise<CommandResponse<TActions>> {
		const selectedActions = this.getSelectedActions(actions);
		const responses = {} as CommandResponse<TActions>;
		for (const [actionKey, action] of selectedActions) {
			responses[actionKey] = (await action.run(
				options,
			)) as CommandResponse<TActions>[keyof TActions];
		}
		return responses as CommandResponse<TActions>;
	}

	protected getSelectedActions(
		actions: TActions,
	): Array<[keyof TActions, TActions[keyof TActions]]> {
		if (!this.actions.length) {
			return [];
		}

		const actionEntries = Object.entries(actions) as Array<
			[keyof TActions, TActions[keyof TActions]]
		>;
		return this.actions.map((ActionClass) => {
			const selectedAction = actionEntries.find(([, action]) => action instanceof ActionClass);
			if (!selectedAction) {
				throw new CommandError(
					`${this.name()} command missing action instance for ${ActionClass.name}`,
				);
			}

			return selectedAction;
		});
	}

	protected throwOnErrors(responses: CommandResponse<TActions>): void {
		const failures = Object.entries(responses).filter(([, response]) => {
			if (!response) {
				return false;
			}

			return !response.succeeded && !response.skipped;
		});

		if (!failures.length) {
			return;
		}

		throw new CommandError(
			`${this.name()} command failed. ${failures
				.map(
					([actionName, response]) => `${actionName}: ${response?.message ?? "Unknown error"}`,
				)
				.join("\n")}`,
		);
	}

	private parseCommandName(stringLike: string | Constructable) {
		const command =
			typeof stringLike === "string"
				? stringLike
				: (stringLike.name?.toLowerCase().replace("command", "") ?? "");

		if (command === "") {
			throw new CommandError(`Could not parse command name from ${stringLike.toString()}`);
		}
		return command;
	}
}
