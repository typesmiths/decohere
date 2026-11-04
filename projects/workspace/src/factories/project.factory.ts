import path from "node:path";
import { type FileEx, io } from "@decohere/core/io";
import { findFiles } from "@decohere/devkit/io";
import { merge } from "@decohere/core/objects";
import { PACKAGE_JSON, PROJECTS_DIR, WorkspaceDefaults } from "../const.js";
import { WorkspaceConfigurationError } from "../errors.js";
import { PackageJson } from "../models/package-json.model.js";
import { Project, type ProjectConfig, type ProjectSeed } from "../models/project.model.js";
import type { WorkspaceOptions } from "../models/workspace-config.type.js";

export class ProjectFactory {
	public static async getProjectSeeds(config: WorkspaceOptions) {
		const { includeProjects, ignoreProjects, rootDir } = config;
		const cwd = rootDir ?? "./";

		const discoveredPackageJsonFiles = await findFiles(includeProjects, {
			cwd,
			ignore: ignoreProjects,
		});
		const packageJsonFiles = ProjectFactory.filterNestedPackageJsonFiles(
			discoveredPackageJsonFiles,
		);
		if (packageJsonFiles.length === 0 && (await ProjectFactory.isStandalone(config))) {
			return [await ProjectFactory.standaloneProject(config)];
		}
		const projects = await Promise.all(
			packageJsonFiles.map((file) => ProjectFactory.projectFrom(file, config)),
		);

		return projects.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * A standalone project: no `projects/` folder and no `includeProjects` of the user's own, but
	 * a root `package.json`. That `package.json` is then the one project, at the root.
	 */
	private static async isStandalone(config: WorkspaceOptions): Promise<boolean> {
		const rootDir = config.rootDir ?? "./";
		const defaultInclude =
			JSON.stringify(config.includeProjects) ===
			JSON.stringify(WorkspaceDefaults.includeProjects);
		return (
			defaultInclude &&
			!(await io.directoryExists(path.join(rootDir, PROJECTS_DIR))) &&
			(await io.fileExists(path.join(rootDir, PACKAGE_JSON)))
		);
	}

	/** The root `package.json` as the one project. Build output and `.git` aren't its sources. */
	private static async standaloneProject(config: WorkspaceOptions): Promise<ProjectSeed> {
		const [packageJsonFile] = await findFiles([PACKAGE_JSON], { cwd: config.rootDir ?? "./" });
		const outDir = (config.outDir ?? WorkspaceDefaults.outDir).replace(/[/\\]+$/, "");
		const ignore = [...(config.ignore ?? []), `${outDir}/**`, ".git/**"];
		return ProjectFactory.projectFrom(packageJsonFile as FileEx, { ...config, ignore });
	}

	private static filterNestedPackageJsonFiles(files: readonly FileEx[]) {
		const normalize = (filePath: string) => filePath.replaceAll("\\", "/");
		const packageJsonSet = new Set(files.map((file) => normalize(file.relativePath)));

		return files.filter((file) => {
			const relativePath = normalize(file.relativePath);
			const projectDir = path.posix.dirname(relativePath);
			let dir = path.posix.dirname(projectDir);
			while (dir !== "." && dir !== "/") {
				if (packageJsonSet.has(`${dir}/package.json`)) {
					return false;
				}
				dir = path.posix.dirname(dir);
			}

			return true;
		});
	}

	public static async getProjects(config: WorkspaceOptions, configuration?: string) {
		const seeds = await ProjectFactory.getProjectSeeds(config);
		return seeds.map((seed) => new Project(seed.name, seed.config, configuration));
	}

	private static async projectFrom(
		file: FileEx,
		config: WorkspaceOptions,
	): Promise<ProjectSeed> {
		const packageJsonData = await io
			.readJsonFile<PackageJson>(file.fullPath)
			.catch((error) => {
				throw new WorkspaceConfigurationError(
					`Error reading package.json ${file.fullPath}`,
					error,
				);
			});
		const name = packageJsonData.name;
		const packageJson = new PackageJson(packageJsonData);
		const projectDir = path.dirname(file.relativePath);
		const mergedConfig = merge.withOptions<ProjectConfig>(
			{ mergeArrays: false },
			config,
			config?.projects?.[name] ?? {},
			{ projectDir, packageJson },
		);
		return { name, config: mergedConfig };
	}
}
