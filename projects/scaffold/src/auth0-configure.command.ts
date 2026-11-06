import { DecohereCommand } from "@decohere/devkit/cli";
import { Auth0ConfigureAction } from "./auth0-configure.action.js";

export class Auth0ConfigureCommand extends DecohereCommand {
	public override get actions() {
		return [Auth0ConfigureAction];
	}

	public constructor(name: string) {
		super(name);
		this.description("Update Auth0 API permissions from @Authorize in this workspace");
		this.option("-d <directory>", "Workspace directory (default: current directory)", ".");
	}
}
