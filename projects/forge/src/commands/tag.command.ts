import { DecohereCommand, DryRunOption } from "@decohere/devkit/cli";
import { Tag } from "../actions/tag.action.js";

export class TagCommand extends DecohereCommand {
	public override get actions() {
		return [Tag];
	}

	public constructor(name: string) {
		super(name);
		this.description("Create and optionally push a git tag for the workspace version");
		this.option("--prefix <prefix>", "Tag prefix", "v");
		this.option("--push", "Push the tag and current branch to origin after tagging", false);
		this.addOption(new DryRunOption("Print the tag without creating it"));
	}
}
