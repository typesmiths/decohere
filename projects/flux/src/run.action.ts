import { injectable } from "@decohere/crucible/decorators";
import { Workspace } from "@decohere/workspace";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { type Logger, scribe } from "@decohere/scribe";
import { flux } from "./flux.js";

export type RunOptions = {
	/** Absolute or cwd-relative path to a `.ts` entry file. */
	entry: string;
	configuration: string;
	/** Arguments forwarded to the entry (bin-style `process.argv.slice(2)`). */
	args?: string[];
};

@injectable()
export class RunAction implements Action<RunOptions> {
	private readonly logger: Logger = scribe.logger(RunAction.name);

	public constructor(private readonly workspace: Workspace) {}

	public async run(options: RunOptions): Promise<ActionResponse> {
		this.logger.trace(`Running ${options.entry}`);
		await flux.run(options.entry, {
			configuration: options.configuration,
			args: options.args,
			workspace: this.workspace,
		});
		return ActionResponse.Success(RunAction.name);
	}
}
