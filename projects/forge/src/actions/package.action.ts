import fs from "node:fs/promises";
import path from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import { type Project, Workspace } from "@decohere/workspace";
import type { Action, ResultStatus } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { Npm } from "@decohere/devkit/interop";
import { io } from "@decohere/core/io";
import { scribe } from "@decohere/scribe";
import { ForgeError, formatUnknownError } from "../errors.js";
import { DependencyPinner } from "../packaging/dependency-pinner.service.js";
import { deployable, PACKAGE_DIR } from "../packaging/deployable.js";
import { ImportGraph, type ReleaseProject } from "../packaging/import-graph.service.js";
import { releaseExports } from "../packaging/release-exports.js";
import { type UiAssets, uiAssets } from "../packaging/ui-assets.js";
import { Release } from "../workspace.config.js";

export type PackageOptions = {
	/** Package name of one deployable. Omit to package every project that has a Dockerfile. */
	project?: string;
};

export type PackageResponse = ResultStatus & {
	projectName: string;
	outDir: string;
	workspacePackages: string[];
	dependencies: Record<string, string>;
	message: string;
};

/**
 * Turns a deployable's release build into one self-contained folder that plain `node` runs:
 * no symlinks, no workspace tooling. See ADR 0006.
 */
@injectable()
export class PackageDeployable implements Action<PackageOptions> {
	#logger = scribe.logger(PackageDeployable.name);
	private readonly npm = new Npm();

	public constructor(
		private readonly workspace: Workspace,
		private readonly importGraph: ImportGraph,
		private readonly pinner: DependencyPinner,
	) {}

	public async run(options: PackageOptions): Promise<ActionResponse<PackageResponse>> {
		const projects = this.workspace.getProjects(Release.name);
		const selected = await this.select(projects, options.project);
		if (typeof selected === "string") {
			return ActionResponse.Error(PackageDeployable.name, selected);
		}
		if (selected.length === 0) {
			this.#logger.info("No projects found with a Dockerfile — nothing to package");
			return ActionResponse.Success(PackageDeployable.name, []);
		}

		const releaseProjects = await this.releaseProjects(projects);
		const responses: PackageResponse[] = [];
		for (const project of selected) {
			responses.push(await this.packageProject(project, releaseProjects, projects));
		}

		return responses.some((response) => !response.succeeded)
			? ActionResponse.Error(PackageDeployable.name, responses)
			: ActionResponse.Success(PackageDeployable.name, responses);
	}

	/** The deployables to package, or the reason a named project cannot be one. */
	private async select(
		projects: readonly Project[],
		requested: string | undefined,
	): Promise<Project[] | string> {
		if (requested == null || requested === "") {
			const found: Project[] = [];
			for (const project of projects) {
				if (await deployable.isDeployable(project)) {
					found.push(project);
				}
			}
			return found;
		}

		const project = projects.find((candidate) => candidate.name === requested);
		if (project == null) {
			return `${requested} is not a workspace project. Known projects: ${projects.map((p) => p.name).join(", ")}`;
		}
		if (!(await deployable.isDeployable(project))) {
			return (
				`${requested} has no ${deployable.dockerfileName(project)}, so it is a library, not a deployable. ` +
				"Libraries are packaged into the deployables that import them."
			);
		}
		return [project];
	}

	private async releaseProjects(
		projects: readonly Project[],
	): Promise<Map<string, ReleaseProject>> {
		const entries = await Promise.all(
			projects.map(async (project): Promise<[string, ReleaseProject]> => {
				const pkg = await project.getPackageJson();
				return [
					project.name,
					{
						name: project.name,
						pkg,
						projectRoot: path.resolve(project.projectRoot),
						releaseDir: path.resolve(project.getOutDir()),
					},
				];
			}),
		);
		return new Map(entries);
	}

	private async packageProject(
		project: Project,
		releaseProjects: ReadonlyMap<string, ReleaseProject>,
		projects: readonly Project[],
	): Promise<PackageResponse> {
		const outDir = path.join(path.resolve(project.projectRoot), PACKAGE_DIR);
		const base = {
			projectName: project.name,
			outDir,
			workspacePackages: [],
			dependencies: {},
		};
		try {
			const entry = releaseProjects.get(project.name) as ReleaseProject;
			if (!(await io.directoryExists(path.join(entry.releaseDir, "es6")))) {
				throw new ForgeError(
					`No release build for ${project.name}. Run \`forge build --configuration release\` first.`,
				);
			}

			const ui = await uiAssets.resolve(project, projects);
			const reached = await this.importGraph.walk(entry, releaseProjects);
			const libraries = [...reached.workspace]
				.filter((name) => name !== project.name)
				.sort()
				.map((name) => releaseProjects.get(name) as ReleaseProject);
			const dependencies = await this.pinner.pin(
				reached.thirdParty,
				[entry, ...libraries],
				releaseProjects,
				{
					dir: path.resolve(this.workspace.rootDir),
					pkg: await this.workspace.getPackageJson(),
				},
			);

			await this.write(entry, libraries, dependencies, outDir, ui);

			const workspacePackages = [...reached.workspace].sort();
			this.#logger.info(`Packaged ${project.name} to ${outDir}`, {
				workspace: workspacePackages,
				thirdParty: Object.keys(dependencies),
			});
			return {
				projectName: project.name,
				outDir,
				workspacePackages,
				dependencies,
				succeeded: true,
				message: `Packaged ${project.name} to ${outDir}`,
			};
		} catch (reason) {
			const message = formatUnknownError(reason);
			return { ...base, succeeded: false, message, error: `${project.name}: ${message}` };
		}
	}

	private async write(
		entry: ReleaseProject,
		libraries: readonly ReleaseProject[],
		dependencies: Record<string, string>,
		outDir: string,
		ui: UiAssets | undefined,
	): Promise<void> {
		await fs.rm(outDir, { recursive: true, force: true });
		await fs.mkdir(outDir, { recursive: true });
		await this.writeJson(path.join(outDir, "package.json"), {
			name: entry.name.replace(/^@/, "").replace("/", "-"),
			version: entry.pkg.version,
			private: true,
			type: "module",
			scripts: { start: `node es6/${releaseExports.toJs(entry.pkg.main ?? "src/index.ts")}` },
			dependencies,
		});

		// npm writes real folders. It also removes anything in node_modules it does not know,
		// so the workspace libraries are copied in only after it has run.
		if (Object.keys(dependencies).length > 0) {
			await this.npm.installProduction({ cwd: outDir });
		}

		await this.copyTree(path.join(entry.releaseDir, "es6"), path.join(outDir, "es6"));
		const config = path.join(path.resolve(this.workspace.rootDir), "config");
		if (await io.directoryExists(config)) {
			await this.copyTree(config, path.join(outDir, "config"));
		}

		if (ui != null) {
			await this.copyTree(ui.from, path.join(outDir, ui.to));
		}

		for (const library of libraries) {
			const target = path.join(outDir, "node_modules", ...library.name.split("/"));
			await this.copyTree(path.join(library.releaseDir, "es6"), path.join(target, "es6"));
			await this.writeJson(path.join(target, "package.json"), {
				name: library.name,
				version: library.pkg.version,
				type: "module",
				exports: releaseExports.build(library.pkg),
			});
		}

		await this.assertNoSymlinks(outDir);
	}

	/** Copies file contents, never links: a symlink in the output would break outside the image. */
	private async copyTree(from: string, to: string): Promise<void> {
		await fs.cp(from, to, { recursive: true, dereference: true });
	}

	private async writeJson(filePath: string, value: unknown): Promise<void> {
		await io.writeFile(filePath, `${JSON.stringify(value, null, "\t")}\n`, {
			mkdir: true,
			encoding: "utf8",
		});
	}

	private async assertNoSymlinks(dir: string): Promise<void> {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const entryPath = path.join(dir, entry.name);
			if (entry.isSymbolicLink()) {
				throw new ForgeError(
					`The packaged output must hold no symlinks, but found ${entryPath}`,
				);
			}
			if (entry.isDirectory()) {
				await this.assertNoSymlinks(entryPath);
			}
		}
	}
}
