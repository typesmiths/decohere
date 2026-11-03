import { DecohereCommand } from "@decohere/devkit/cli";
import { Auth0LoginAction } from "./auth0-login.action.js";

export class Auth0LoginCommand extends DecohereCommand {
	public override get actions() {
		return [Auth0LoginAction];
	}

	public constructor(name: string) {
		super(name);
		this.description("Authenticate the Auth0 CLI (device URL; tokens persist on the host)");
	}
}
