import { injectable } from "@decohere/crucible/decorators";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { runAuth0Token } from "./webapi/auth0-commands.js";

export type Auth0TokenOptions = {
	d?: string;
};

@injectable()
export class Auth0TokenAction implements Action<Auth0TokenOptions> {
	public async run(options: Auth0TokenOptions): Promise<ActionResponse> {
		runAuth0Token(typeof options.d === "string" ? options.d : ".");
		return ActionResponse.Success("token");
	}
}
