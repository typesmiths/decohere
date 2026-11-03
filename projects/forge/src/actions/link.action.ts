import fs from "node:fs/promises";
import path from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import { Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { scribe } from "@decohere/scribe";
import "../extensions/project.extensions.js";
import { ForgeError } from "../errors.js";

export const LINK_MANIFEST = ".forge-link.json";

export type LinkOptions = {
	configuration: string;
	targetDir: string;
};

export const DEFAULT_LINK_CONFIGURATION = "link";

export type LinkManifest = {
	workspaceRoot: string;
	peerNodeModulesDir?: string;
	links: Array<{ packageName: string; symlinkPath: string; originalPath: string | null }>;
};

@injectable()
export class Link implements Action<LinkOptions> {
	#logger = scribe.logger(Link.name);

	public constructor(private readonly workspace: Workspace) {}

	public run = async (options: LinkOptions): Promise<ActionResponse> => {
		const targetDir = path.resolve(options.targetDir);
		const nodeModulesDir = path.join(targetDir, "node_modules");

		const stat = await fs.stat(nodeModulesDir).catch(() => null);
		if (stat == null) {
			throw new ForgeError(
				`node_modules not found in "${targetDir}". Run pnpm install first.`,
			);
		}

		const projects = this.workspace.getProjects(options.configuration);
		if (projects.length === 0) {
			throw new ForgeError(`No projects found for configuration "${options.configuration}"`);
		}

		// Load any existing manifest so originalPath values are preserved on re-link
		const manifestPath = path.join(targetDir, LINK_MANIFEST);
		const existingManifestText = await fs.readFile(manifestPath, "utf8").catch(() => null);
		const existingManifest: LinkManifest | null =
			existingManifestText != null ? JSON.parse(existingManifestText) : null;

		const manifest: LinkManifest = {
			workspaceRoot: this.workspace.rootDir,
			links: [],
		};

		for (const project of projects) {
			const pkg = await project.getPackageJson();
			const packageName = pkg.name;
			if (!packageName) {
				this.#logger.trace(`Skipping project "${project.name}" — no package name`);
				continue;
			}

			// Resolve the build output directory (no target arg — debug config is not packed)
			const outDir = project.getOutDir();
			const absoluteOutDir = path.resolve(outDir);

			// Pre-create the output dir so the symlink is valid even before a build completes.
			await fs.mkdir(absoluteOutDir, { recursive: true });

			// Compute symlink path inside target node_modules
			const symlinkPath = path.join(nodeModulesDir, ...packageName.split("/"));
			const symlinkParent = path.dirname(symlinkPath);

			// Capture any existing entry so we can restore it on unlink.
			// If a manifest already exists for this package, preserve its originalPath —
			// the current symlink is our own and must not be treated as the original.
			let originalPath: string | null = null;
			const existingStat = await fs.lstat(symlinkPath).catch(() => null);
			if (existingStat != null) {
				const existingEntry = existingManifest?.links.find(
					(l) => l.packageName === packageName,
				);
				if (existingEntry != null) {
					// Already linked — preserve the recorded originalPath and replace the symlink
					originalPath = existingEntry.originalPath;
					if (existingStat.isSymbolicLink()) {
						await fs.unlink(symlinkPath);
					}
				} else if (existingStat.isSymbolicLink()) {
					originalPath = await fs.readlink(symlinkPath);
					await fs.unlink(symlinkPath);
				} else {
					// Real directory — back it up by renaming
					originalPath = `${symlinkPath}.__forge_backup__`;
					await fs.rename(symlinkPath, originalPath);
				}
			}

			await fs.mkdir(symlinkParent, { recursive: true });
			await fs.symlink(absoluteOutDir, symlinkPath, "dir");

			manifest.links.push({ packageName, symlinkPath, originalPath });
			this.#logger.info(`Linked ${packageName} → ${absoluteOutDir}`);
		}

		// Create a peer node_modules at the build output root so Node can resolve
		// bare specifiers from the real (non-symlink) paths of linked packages.
		if (manifest.links.length > 0) {
			const buildRoot = path.resolve(projects[0].getRootOut());
			const peerNodeModulesDir = path.join(buildRoot, "node_modules");
			await fs.rm(peerNodeModulesDir, { recursive: true, force: true });
			for (const project of projects) {
				const pkg = await project.getPackageJson();
				if (!pkg.name) continue;
				const outDir = path.resolve(project.getOutDir());
				const peerSymlink = path.join(peerNodeModulesDir, ...pkg.name.split("/"));
				await fs.mkdir(path.dirname(peerSymlink), { recursive: true });
				await fs.symlink(outDir, peerSymlink, "dir");
				this.#logger.trace(`Peer-linked ${pkg.name} → ${outDir}`);
			}
			manifest.peerNodeModulesDir = peerNodeModulesDir;
			this.#logger.info(`Created peer node_modules at ${peerNodeModulesDir}`);
		}

		await fs.writeFile(path.join(targetDir, LINK_MANIFEST), JSON.stringify(manifest, null, 2));

		return ActionResponse.Success(Link.name);
	};
}
