import { injectable } from "@decohere/crucible/decorators";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { Pnpm } from "@decohere/devkit/interop";
import { scribe } from "@decohere/scribe";
import { formatUnknownError } from "../errors.js";

export type SyncLockFileOptions = {
	sync?: boolean;
	dryRun?: boolean;
};

@injectable()
export class SyncLockFile implements Action<SyncLockFileOptions> {
	#logger = scribe.logger(SyncLockFile.name);
	#pnpm = new Pnpm();

	public async run(options: SyncLockFileOptions): Promise<ActionResponse> {
		const shouldSync = options.sync ?? true;

		if (options.dryRun || !shouldSync) {
			this.#logger.info(
				options.dryRun ? "[dry-run] Skipping lockfile sync" : "Skipping lockfile sync",
			);
			return ActionResponse.Skipped(SyncLockFile.name);
		}

		try {
			await this.#pnpm.syncLockFile();
		} catch (reason) {
			return ActionResponse.Error(
				SyncLockFile.name,
				`Failed syncing lockfile: ${formatUnknownError(reason)}`,
			);
		}

		return ActionResponse.Success(SyncLockFile.name);
	}
}
