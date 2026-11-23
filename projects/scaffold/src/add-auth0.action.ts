import { injectable } from "@decohere/crucible/decorators";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { runAddAuth0 } from "./webapi/add-steps.js";

export type AddAuth0Options = {
	d?: string;
	dryRun?: boolean;
};

@injectable()
export class AddAuth0Action implements Action<AddAuth0Options> {
	public async run(options: AddAuth0Options): Promise<ActionResponse> {
		runAddAuth0(typeof options.d === "string" ? options.d : ".", {
			dryRun: options.dryRun === true,
		});
		return ActionResponse.Success("auth0");
	}
}
