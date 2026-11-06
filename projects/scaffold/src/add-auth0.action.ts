import { injectable } from "@decohere/crucible/decorators";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { runAddAuth0 } from "./webapi/add-auth0.js";

export type AddAuth0Options = {
	d?: string;
};

@injectable()
export class AddAuth0Action implements Action<AddAuth0Options> {
	public async run(options: AddAuth0Options): Promise<ActionResponse> {
		runAddAuth0(typeof options.d === "string" ? options.d : ".");
		return ActionResponse.Success("auth0");
	}
}
