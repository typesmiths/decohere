import { DecohereCommand } from "@decohere/devkit/cli";
import { AddAuth0Action } from "./add-auth0.action.js";

export class AddAuth0Command extends DecohereCommand {
	public override get actions() {
		return [AddAuth0Action];
	}

	public constructor(name: string) {
		super(name);
		this.description("Add Auth0 to an existing Decohere workspace");
		this.option("-d <directory>", "Workspace directory (default: current directory)", ".");
	}
}
