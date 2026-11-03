import { DecohereCommand } from "@decohere/devkit/cli";
import type { OptionValues } from "commander";
import { AddApiAction } from "./add-api.action.js";
import { addWebapiFeatureOptions } from "./webapi/cli-options.js";

export class AddApiCommand extends DecohereCommand {
	public override get actions() {
		return [AddApiAction];
	}

	public constructor(name: string) {
		super(name);
		this.description("Add an API to an existing Decohere workspace");
		this.argument("<name>", "API name under projects/");
		this.option("-d <directory>", "Workspace directory (default: current directory)", ".");
		addWebapiFeatureOptions(this);
	}

	public override action(fn: (...args: unknown[]) => void | Promise<void>): this {
		return super.action((...args: unknown[]) => {
			const cmd = args.at(-1) as DecohereCommand;
			const first = args[0];
			const hasPositional = typeof first === "string" || first === undefined;
			const opts = hasPositional ? (args[1] as OptionValues) : (args[0] as OptionValues);
			if (typeof first === "string" && first !== "") {
				cmd.setOptionValue("apiName", first);
			}
			return fn(opts, cmd);
		});
	}
}
