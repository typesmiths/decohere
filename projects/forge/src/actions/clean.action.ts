import { injectable } from "@decohere/crucible/decorators";
import { Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { io } from "@decohere/core/io";
import { scribe } from "@decohere/scribe";

export type CleanOptions = {
	clean: boolean;
	configuration: string;
};

@injectable()
export class Clean implements Action<CleanOptions> {
	#logger = scribe.logger(Clean.name);
	public constructor(private readonly workspace: Workspace) {}

	public run = async (options: CleanOptions): Promise<ActionResponse> => {
		if (!options.clean) {
			this.#logger.info("Skipping clean");
			return ActionResponse.Skipped(Clean.name);
		}

		const outDirs = this.workspace
			.getProjects(options.configuration)
			.map((proj) => proj.getRootOut())
			.filter((dir, i, arr) => arr.indexOf(dir) === i); // dedupe

		await Promise.all(
			outDirs.map(async (outDir) => {
				await io.removeDir(outDir, { force: true, recursive: true });
				this.#logger.trace(`Cleaned ${outDir}`);
			}),
		);

		return ActionResponse.Success(Clean.name);
	};
}
