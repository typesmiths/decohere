import type { Actions } from "@decohere/devkit/cli";
import {
	type CommandHandler,
	type CommandResponse,
	type CommandType,
	DecohereCommand,
} from "@decohere/devkit/cli";

export class Auth0Command extends DecohereCommand {
	public constructor(commands: Record<string, CommandType>, handler: CommandHandler) {
		super(Auth0Command);
		this.description("Log in to Auth0 and update a scaffolded client");
		this.exitOverride();
		this.registerSubcommand(commands, handler);
	}

	public run(_actions: Actions, _options: never): Promise<CommandResponse> {
		return this.help();
	}
}
