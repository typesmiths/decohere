import { injectable } from "@decohere/crucible/decorators";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { runScaffoldApi, toApiOptions } from "./webapi/cli-options.js";

export type WebapiOptions = {
	directory?: string;
	d?: string;
	name?: string | string[];
	database?: string;
	auth?: string;
	postman?: string;
	yes?: boolean;
	install?: string;
};

@injectable()
export class WebapiAction implements Action<WebapiOptions> {
	public async run(options: WebapiOptions): Promise<ActionResponse> {
		await runScaffoldApi(toApiOptions(options.directory, options));
		return ActionResponse.Success("webapi");
	}
}
