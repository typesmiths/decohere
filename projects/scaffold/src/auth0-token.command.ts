import { DecohereCommand } from "@decohere/devkit/cli";
import { Auth0TokenAction } from "./auth0-token.action.js";

export class Auth0TokenCommand extends DecohereCommand {
	public override get actions() {
		return [Auth0TokenAction];
	}

	public constructor(name: string) {
		super(name);
		this.description("Print an access token for calling this workspace's API in development");
		this.option("-d <directory>", "Workspace directory (default: current directory)", ".");
	}
}
