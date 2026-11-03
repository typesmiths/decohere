import { ConfigurationOption, DecohereCommand } from "@decohere/devkit/cli";
import { TypeCheck } from "../actions/typecheck.action.js";

export class TypeCheckCommand extends DecohereCommand {
	public override get actions() {
		return [TypeCheck];
	}

	public constructor(name: string) {
		super(name);
		this.description("Type-check workspace projects without emitting files");
		this.addOption(new ConfigurationOption("debug"));
	}
}
