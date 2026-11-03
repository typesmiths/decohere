import path from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import { Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { Git } from "@decohere/devkit/interop";
import { scribe } from "@decohere/scribe";
import { formatUnknownError } from "../errors.js";
import { Release } from "../workspace.config.js";

export type CommitFilesOptions = {
	configuration?: string;
	commit?: boolean;
	message?: string;
	files?: string[];
	dryRun?: boolean;
};

const KnownLockFiles = ["pnpm-lock.yaml"];

@injectable()
export class CommitFiles implements Action<CommitFilesOptions> {
	#logger = scribe.logger(CommitFiles.name);
	#git = new Git();

	public constructor(private readonly workspace: Workspace) {}

	public async run(options: CommitFilesOptions): Promise<ActionResponse> {
		if (!options.commit) {
			return ActionResponse.Skipped(CommitFiles.name);
		}

		if (options.dryRun) {
			this.#logger.info("[dry-run] Skipping commit");
			return ActionResponse.Skipped(CommitFiles.name);
		}

		const files = options.files ?? this.getDefaultFiles(options.configuration ?? Release.name);
		if (files.length === 0) {
			this.#logger.info("No files provided for commit, skipping");
			return ActionResponse.Skipped(CommitFiles.name);
		}

		const message = options.message ?? "chore: sync workspace package manifests [skip ci]";
		this.#logger.info(`Committing synced manifests: ${message}`);

		try {
			await this.#git.commit(message, { files });
			return ActionResponse.Success(CommitFiles.name);
		} catch (reason) {
			return ActionResponse.Error(
				CommitFiles.name,
				`Failed committing files: ${formatUnknownError(reason)}`,
			);
		}
	}

	private getDefaultFiles(configuration: string): string[] {
		const cwd = process.cwd();
		const manifestFiles = [
			path.relative(cwd, path.resolve(this.workspace.packageJsonPath)),
			...this.workspace
				.getProjects(configuration)
				.map((project) => path.relative(cwd, path.resolve(project.packageJsonPath))),
		];

		return [...manifestFiles, ...KnownLockFiles];
	}
}
