import { injectable } from "@decohere/crucible/decorators";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { runAddUsers } from "./webapi/add-steps.js";

export type AddUsersOptions = {
	d?: string;
	admin?: string;
	dryRun?: boolean;
};

@injectable()
export class AddUsersAction implements Action<AddUsersOptions> {
	public async run(options: AddUsersOptions): Promise<ActionResponse> {
		runAddUsers(typeof options.d === "string" ? options.d : ".", {
			admin: options.admin,
			dryRun: options.dryRun === true,
		});
		return ActionResponse.Success("users");
	}
}
