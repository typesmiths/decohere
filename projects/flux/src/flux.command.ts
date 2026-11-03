import type { Actions } from "@decohere/devkit/cli";
import {
	type CommandHandler,
	type CommandResponse,
	type CommandType,
	DecohereCommand,
} from "@decohere/devkit/cli";
import { RunCommand } from "./run.command.js";
import { ServeCommand } from "./serve.command.js";

export class FluxCommand extends DecohereCommand {
	public constructor(commands: Record<string, CommandType>, handler: CommandHandler) {
		super(FluxCommand);
		this.exitOverride();
		this.registerSubcommand({ serve: ServeCommand, run: RunCommand, ...commands }, handler);
	}

	public run(_actions: Actions, _options: never): Promise<CommandResponse> {
		return this.help();
	}
}
