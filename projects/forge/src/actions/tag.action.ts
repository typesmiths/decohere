import { injectable } from "@decohere/crucible/decorators";
import { Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { Git } from "@decohere/devkit/interop";
import { scribe } from "@decohere/scribe";
import { ForgeError, formatUnknownError } from "../errors.js";

export type TagOptions = {
	prefix?: string;
	dryRun?: boolean;
	push?: boolean;
};

export type TagResponse = {
	tag: string;
	succeeded: boolean;
	error?: string;
};

@injectable()
export class Tag implements Action<TagOptions> {
	#logger = scribe.logger(Tag.name);
	public constructor(private readonly workspace: Workspace) {}

	public async run(options: TagOptions): Promise<ActionResponse<TagResponse>> {
		try {
			const version = await this.workspace.getVersion();
			const prefix = options.prefix ?? "v";
			const tag = `${prefix}${version}`;

			if (options.dryRun) {
				this.#logger.info(`[dry-run] ${tag}`);
				return ActionResponse.Success<TagResponse>(Tag.name, [{ tag, succeeded: true }]);
			}

			this.#logger.info(`Creating tag: ${tag}`);
			const git = new Git();
			await git.tag(tag);

			if (options.push) {
				// Tag-only: Publish checks out a commit SHA (detached HEAD). Pushing a
				// branch name is wrong there and unnecessary — the version label is the tag.
				this.#logger.info(`Pushing tag: ${tag}`);
				await git.pushTag(tag);
			}

			return ActionResponse.Success<TagResponse>(Tag.name, [{ tag, succeeded: true }]);
		} catch (reason) {
			const error = formatUnknownError(reason);
			throw new ForgeError(`Failed to create tag: ${error}`);
		}
	}
}
