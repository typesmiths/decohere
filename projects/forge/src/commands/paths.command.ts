import { DecohereCommand } from "@decohere/devkit/cli";
import { Paths } from "../actions/paths.action.js";

export class PathsCommand extends DecohereCommand {
	public override get actions() {
		return [Paths];
	}

	public constructor(name: string) {
		super(name);
		this.description(
			"Write tsconfig.paths.json: tsconfig paths for the workspace packages and their exported subpaths",
		);
		this.option("--check", "Fail if tsconfig.paths.json is missing or out of date", false);
	}
}
