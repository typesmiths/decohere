import { type CommandHandler, type CommandType, DecohereCommand } from "@decohere/devkit/cli";
import type { OptionValues } from "commander";
import { DbAction } from "./db.action.js";

const COMMANDS = `
Commands (run by the API's src/db.ts):
  migrate [--to <id>] [--dry-run]   apply pending migrations
  status                            list applied, pending and unknown migrations
  revert                            undo the last migration applied
  new <name> [--data]               write an empty migration
  generate <name>                   write a migration from the mappings' difference
  --data-source <name>              pick a data source when the API has several

Examples:
  pnpm decohere db migrate
  pnpm decohere db generate add-expiry --api shop`;

export class DbCommand extends DecohereCommand {
	public override get actions() {
		return [DbAction];
	}

	public constructor(_commands: Record<string, CommandType>, handler: CommandHandler) {
		super(DbCommand);
		this.description("Run an API's database commands: migrate, status, revert, new, generate");
		this.usage("<command> [options] [--api <name>]");
		this.argument("[args...]", "the command and its options, passed to src/db.ts");
		this.option("--api <name>", "the API to run them for, when several have a src/db.ts");
		// The db command's own options (--to, --dry-run, --data…) belong to db.ts, not to this CLI.
		this.allowUnknownOption();
		this.addHelpText("after", COMMANDS);
		this.action(handler);
	}

	/** Commander passes `(args, opts, cmd)`; the CLI host expects `(opts, cmd)` with args on opts. */
	public override action(
		fn: (opts: OptionValues, cmd: DecohereCommand) => void | Promise<void>,
	): this {
		return super.action((args: string[], opts: OptionValues, cmd: DecohereCommand) => {
			cmd.setOptionValue("args", args);
			return fn(opts, cmd);
		});
	}
}
