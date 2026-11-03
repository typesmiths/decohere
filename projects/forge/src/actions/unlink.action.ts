import fs from "node:fs/promises";
import path from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { scribe } from "@decohere/scribe";
import { ForgeError } from "../errors.js";
import { LINK_MANIFEST, type LinkManifest } from "./link.action.js";

export type UnlinkOptions = {
	targetDir: string;
};

@injectable()
export class Unlink implements Action<UnlinkOptions> {
	#logger = scribe.logger(Unlink.name);

	public run = async (options: UnlinkOptions): Promise<ActionResponse> => {
		const targetDir = path.resolve(options.targetDir);
		const manifestPath = path.join(targetDir, LINK_MANIFEST);

		const manifestStat = await fs.stat(manifestPath).catch(() => null);
		if (manifestStat == null) {
			throw new ForgeError(`No link manifest found at "${manifestPath}". Nothing to unlink.`);
		}

		const manifest: LinkManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

		for (const { packageName, symlinkPath, originalPath } of manifest.links) {
			const stat = await fs.lstat(symlinkPath).catch(() => null);
			if (stat?.isSymbolicLink()) {
				await fs.unlink(symlinkPath);
				this.#logger.trace(`Removed symlink for ${packageName}`);
			}

			if (originalPath != null) {
				const backupStat = await fs.stat(originalPath).catch(() => null);
				if (backupStat != null) {
					await fs.rename(originalPath, symlinkPath);
					this.#logger.trace(`Restored original dir for ${packageName}`);
				} else {
					// originalPath is a symlink target string — recreate the symlink
					await fs.mkdir(path.dirname(symlinkPath), { recursive: true });
					await fs.symlink(originalPath, symlinkPath, "dir");
					this.#logger.trace(`Restored original symlink for ${packageName}`);
				}
			}

			this.#logger.info(`Unlinked ${packageName}`);
		}

		await fs.unlink(manifestPath);

		if (manifest.peerNodeModulesDir != null) {
			await fs.rm(manifest.peerNodeModulesDir, { recursive: true, force: true });
			this.#logger.info(`Removed peer node_modules at ${manifest.peerNodeModulesDir}`);
		}

		return ActionResponse.Success(Unlink.name);
	};
}
