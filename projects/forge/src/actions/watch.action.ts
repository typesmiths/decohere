import { injectable } from "@decohere/crucible/decorators";
import { Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { scribe } from "@decohere/scribe";

export type WatchOptions = {
	watch: boolean;
	configuration: string;
};

@injectable()
export class Watch implements Action<WatchOptions> {
	#logger = scribe.logger(Watch.name);
	public constructor(private readonly workspace: Workspace) {}

	public run = async (options: WatchOptions): Promise<ActionResponse> => {
		if (!options.watch) {
			this.#logger.info(`Skipping ${Watch.name}`);
			return ActionResponse.Skipped(Watch.name);
		}

		// A project with its own build script isn't forge's to rebuild; flux serve runs its dev script.
		await this.workspace.watch(
			options.configuration,
			(project) => project.getOwnScript("build") == null,
		);
		this.#logger.info(`Starting watch`);
		return ActionResponse.Blocking(Watch.name);
	};

	public [Symbol.dispose]() {
		this.workspace.stopWatching();
	}
}
