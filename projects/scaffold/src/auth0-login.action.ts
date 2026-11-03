import { injectable } from "@decohere/crucible/decorators";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { runAuth0Login } from "./webapi/auth0-commands.js";

@injectable()
export class Auth0LoginAction implements Action {
	public async run(): Promise<ActionResponse> {
		runAuth0Login();
		return ActionResponse.Success("login");
	}
}
