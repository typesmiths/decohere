import { injectable } from "@decohere/crucible/decorators";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { runAuth0Configure } from "./webapi/auth0-commands.js";

export type Auth0ConfigureOptions = {
	d?: string;
};

@injectable()
export class Auth0ConfigureAction implements Action<Auth0ConfigureOptions> {
	public async run(options: Auth0ConfigureOptions): Promise<ActionResponse> {
		runAuth0Configure(typeof options.d === "string" ? options.d : ".");
		return ActionResponse.Success("configure");
	}
}
