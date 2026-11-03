import { DecohereCommand } from "@decohere/devkit/cli";
import type { OptionValues } from "commander";
import { addWebapiFeatureOptions, collectName } from "./webapi/cli-options.js";
import { WebapiAction } from "./webapi.action.js";

export class WebapiCommand extends DecohereCommand {
	public override get actions() {
		return [WebapiAction];
	}

	public constructor(name: string) {
		super(name);
		this.description("Scaffold a web API workspace");
		this.argument("[directory]", "Target directory (default: -d or current directory)");
		this.option("-d <directory>", "Target directory (default: current directory)", ".");
		this.option(
			"--name <slug>",
			"API name under projects/ (repeatable; default: api)",
			collectName,
			[] as string[],
		);
		addWebapiFeatureOptions(this);
	}

	/**
	 * Commander passes positional args before options when `[directory]` is declared.
	 * ModuleFactory expects `(opts, cmd)` — stash the directory on the command.
	 */
	public override action(fn: (...args: unknown[]) => void | Promise<void>): this {
		return super.action((...args: unknown[]) => {
			const cmd = args.at(-1) as DecohereCommand;
			const first = args[0];
			const hasPositional = typeof first === "string" || first === undefined;
			const opts = hasPositional ? (args[1] as OptionValues) : (args[0] as OptionValues);
			if (typeof first === "string" && first !== "") {
				cmd.setOptionValue("directory", first);
			}
			return fn(opts, cmd);
		});
	}
}
