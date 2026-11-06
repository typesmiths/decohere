import { injectable } from "@decohere/crucible/decorators";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { runScaffoldApi, toApiOptions } from "./webapi/cli-options.js";

export type AddApiOptions = {
	apiName?: string;
	d?: string;
	database?: string;
	auth?: string;
	yes?: boolean;
	install?: string;
};

@injectable()
export class AddApiAction implements Action<AddApiOptions> {
	public async run(options: AddApiOptions): Promise<ActionResponse> {
		const name = options.apiName;
		if (name == null || name === "") {
			return ActionResponse.Error("api", "API name is required");
		}
		await runScaffoldApi(toApiOptions(undefined, options, { names: [name], add: true }));
		return ActionResponse.Success("api");
	}
}
