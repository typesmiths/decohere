import { injectable } from "@decohere/crucible/decorators";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { runAddPostgres } from "./webapi/add-steps.js";
import { parseOrm } from "./webapi/database-provider.js";

export type AddPostgresOptions = {
	d?: string;
	orm?: string;
	dryRun?: boolean;
};

@injectable()
export class AddPostgresAction implements Action<AddPostgresOptions> {
	public async run(options: AddPostgresOptions): Promise<ActionResponse> {
		runAddPostgres(typeof options.d === "string" ? options.d : ".", {
			orm: parseOrm(options.orm ?? "mikro-orm"),
			dryRun: options.dryRun === true,
		});
		return ActionResponse.Success("postgres");
	}
}
