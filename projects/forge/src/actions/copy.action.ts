import path from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import { type Project, Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { type FileEx, io } from "@decohere/core/io";
import { findFiles } from "@decohere/devkit/io";
import { retry } from "@decohere/core/system";
import { scribe } from "@decohere/scribe";
import type { ForgeConfiguration } from "../types/configuration.type.js";

const COPY_RETRY_ATTEMPTS = 3;
const COPY_RETRY_DELAY_MS = 25;

export type CopyOptions = {
	copy: boolean;
	configuration: string;
};

@injectable()
export class Copy implements Action<CopyOptions> {
	#logger = scribe.logger(Copy.name);
	public constructor(private readonly workspace: Workspace) {}

	public run = async (options: CopyOptions): Promise<ActionResponse> => {
		if (!options.copy) {
			this.#logger.info("Skipping copy");
			return ActionResponse.Skipped(Copy.name);
		}

		await Promise.all(
			this.workspace.getProjects(options.configuration).map(async (proj) => {
				const cwd = proj.projectDirectory;
				const root = proj.getOutDir();

				// Workspace + configuration copyFiles → package root (historic behaviour).
				const rootFiles = await findFiles(proj.copyFiles, { cwd });
				await Promise.all(rootFiles.map((file) => this.copyFileToOut(file, root)));
				await this.copyWorkspaceLicense(proj, rootFiles, root);

				// Configuration-only globs → each pack target outDir (next to emitted JS).
				await this.copyColocatedPackAssets(proj, cwd);
			}),
		);

		return ActionResponse.Success(Copy.name);
	};

	/**
	 * A package without a LICENSE of its own ships the workspace's, so a monorepo
	 * licensed once at the root still puts the license text in every tarball.
	 */
	private async copyWorkspaceLicense(
		proj: Project,
		rootFiles: FileEx[],
		outDir: string,
	): Promise<void> {
		if (!(proj.configuration as ForgeConfiguration).pack) {
			return;
		}
		if (rootFiles.some((file) => /^LICEN[CS]E/i.test(file.relativePath))) {
			return;
		}
		const licenses = await findFiles(["LICENSE*", "LICENCE*"], {
			cwd: this.workspace.rootDir,
		});
		await Promise.all(licenses.map((file) => this.copyFileToOut(file, outDir)));
	}

	/**
	 * Packed builds emit JS under `<out>/<target>/` (e.g. `es6/`). Assets listed on
	 * the *configuration* `copyFiles` (not the workspace defaults) are also copied
	 * into each target so `import.meta.url` resolves them beside that JS.
	 *
	 * Workspace `copyFiles` (e.g. `package.json`) stay root-only — nesting a
	 * package manifest under `es6/` makes `npm install --install-links` drop the
	 * parent's `es6/` tree when packing `file:` deps.
	 */
	private async copyColocatedPackAssets(proj: Project, cwd: string): Promise<void> {
		const colocatedPatterns = proj.configuration.copyFiles ?? [];
		if (colocatedPatterns.length === 0) {
			return;
		}

		const config = proj.configuration as ForgeConfiguration;
		if (!config.pack) {
			return;
		}

		const targets = config.targets ?? [];
		if (targets.length === 0) {
			return;
		}

		const files = await findFiles(colocatedPatterns, { cwd });
		const targetDirs = [...new Set(targets.map((target) => proj.getOutDir(target)))];
		await Promise.all(
			targetDirs.flatMap((outDir) => files.map((file) => this.copyFileToOut(file, outDir))),
		);
	}

	@retry({ attempts: COPY_RETRY_ATTEMPTS, delayMs: COPY_RETRY_DELAY_MS })
	private async copyFileToOut(file: FileEx, outDir: string) {
		const dest = path.join(outDir, file.relativePath);
		await io.copyFile(file.fullPath, dest, { mkdir: true });
		this.#logger.trace(`Copied ${file.fullPath} -> ${dest}`);
	}
}
