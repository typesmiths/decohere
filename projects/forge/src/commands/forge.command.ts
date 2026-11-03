import type { Actions } from "@decohere/devkit/cli";
import {
	type CommandHandler,
	type CommandResponse,
	type CommandType,
	DecohereCommand,
} from "@decohere/devkit/cli";

export class ForgeCommand extends DecohereCommand {
	public constructor(commands: Record<string, CommandType>, handler: CommandHandler) {
		super(ForgeCommand);
		this.description("Run forge workspace workflows");
		this.exitOverride();
		this.registerSubcommand(commands, handler);
	}

	public run(_actions: Actions, _options: never): Promise<CommandResponse> {
		return this.help();
	}
}
