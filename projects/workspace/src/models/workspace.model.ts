import { injectable } from "@decohere/crucible/decorators";
import { collections } from "@decohere/core/collections";
import { mixwith } from "@decohere/core/extensibility";
import type { FileEx } from "@decohere/core/io";
import type { Subscription } from "rxjs";
import { Subject } from "rxjs";
import { WorkspaceConfigurationError } from "../errors.js";
import { HasPackageJson } from "./has-package-json.mixin.js";
import { HasTsConfig } from "./has-tsconfig.mixin.js";
import { type PackageAliases, packageAliases } from "./package-aliases.js";
import { PackageJson } from "./package-json.model.js";
import { Project, type ProjectSeed } from "./project.model.js";
import type { ProjectFileEvent } from "./project-file-event.js";
import type { WorkspaceOptions } from "./workspace-config.type.js";

export type WorkspaceInitOptions = {
	packageJson?: PackageJson;
	config: Partial<WorkspaceOptions>;
	projects: ProjectSeed[];
};

@injectable()
export class Workspace extends mixwith(HasPackageJson, HasTsConfig) {
	protected packageJson?: PackageJson;
	readonly #name: string;
	readonly #config: Partial<WorkspaceOptions>;
	readonly #projectSeeds: readonly ProjectSeed[] = [];
	readonly #projectCache = new Map<string, readonly Project[]>();
	/**
	 * Each project's source file paths as a set, so `findProject` is a lookup rather than a scan
	 * of every file: the Vitest plugin asks once per transformed file. Keyed by the list
	 * `getAllFiles` returns, so a new list (after its cache is flushed) gets a new set.
	 */
	readonly #sourcePaths = new WeakMap<readonly FileEx[], Set<string>>();
	readonly #projectFileChangedSubject = new Subject<ProjectFileEvent>();
	readonly #projectWatchSubscriptions = new Map<string, Subscription>();
	#watchedProjects: readonly Project[] = [];

	public constructor(options: Partial<WorkspaceInitOptions> = {}) {
		super();
		const { packageJson, config, projects } = options;
		this.#name = packageJson?.name ?? "WORKSPACE";
		this.packageJson = packageJson ?? new PackageJson();
		this.#config = config ?? {};
		this.#projectSeeds = projects ?? [];
		this.validateWorkspace();
	}

	public get name() {
		return this.#name;
	}

	protected get projectSeeds(): readonly ProjectSeed[] {
		return this.#projectSeeds;
	}

	public getProjects(configuration: string): readonly Project[] {
		const cached = this.#projectCache.get(configuration);
		if (cached != null) {
			return cached;
		}

		const projects = this.#projectSeeds.map(
			(seed) => new Project(seed.name, seed.config ?? ({} as never), configuration),
		);
		this.#projectCache.set(configuration, projects);
		return projects;
	}

	public get rootDir(): string {
		return this.#config.rootDir ?? "./";
	}

	/**
	 * One project, whose `package.json` is the root's: a folder without `projects/`. Commands
	 * that write a project's manifest from the root's (dependency sync) or map projects to each
	 * other (paths) have nothing to do then.
	 */
	public get isStandalone(): boolean {
		return (
			this.#projectSeeds.length === 1 && this.#projectSeeds[0]?.config?.projectDir === "."
		);
	}

	public get packageJsonDirectory(): string {
		return this.rootDir;
	}

	protected get tsConfigDirectory(): string {
		return this.rootDir;
	}

	protected get fallbackTsConfigDirectory(): string | undefined {
		return undefined;
	}

	/**
	 * Package-name aliases for this configuration: workspace convention, then
	 * workspace `tsconfig.json` `paths` overrides. Forge and Flux must use this
	 * instead of assembling the map themselves.
	 */
	public getPackageAliases(configuration: string): PackageAliases {
		const tsconfig = this.findTsConfigPath() != null ? this.getTsConfigSync() : undefined;
		const baseUrl =
			typeof tsconfig?.compilerOptions?.baseUrl === "string" &&
			tsconfig.compilerOptions.baseUrl.length > 0
				? tsconfig.compilerOptions.baseUrl
				: this.rootDir;

		return packageAliases.build(this.getProjects(configuration), {
			baseUrl,
			tsconfigPaths: tsconfig?.compilerOptions?.paths as Record<string, string[]> | undefined,
		});
	}

	public async watch(configuration: string) {
		this.stopWatching();
		const projects = this.getProjects(configuration);
		this.#watchedProjects = projects;

		for (const project of projects) {
			await project.watch(configuration);
			const subscription = project.projectFileChanged$.subscribe((evt) =>
				this.#projectFileChangedSubject.next(evt),
			);

			this.#projectWatchSubscriptions.set(project.projectDirectory, subscription);
		}
	}

	public stopWatching() {
		for (const subscription of this.#projectWatchSubscriptions.values()) {
			subscription.unsubscribe();
		}

		for (const project of this.#watchedProjects) {
			project.stopWatching();
		}

		this.#watchedProjects = [];
		this.#projectWatchSubscriptions.clear();
	}

	public [Symbol.dispose]() {
		this.stopWatching();
	}

	public get projectFileChanged$() {
		return this.#projectFileChangedSubject.asObservable();
	}

	public async findProject(
		filePath: string,
		buildConfig: string,
	): Promise<Project | undefined> {
		for (const project of this.getProjects(buildConfig)) {
			if ((await this.sourcePathsOf(project)).has(filePath)) {
				return project;
			}
		}
		return undefined;
	}

	private async sourcePathsOf(project: Project): Promise<Set<string>> {
		const files = await project.getAllFiles();
		const cached = this.#sourcePaths.get(files);
		if (cached != null) return cached;
		const paths = new Set(files.map((file) => file.fullPath));
		this.#sourcePaths.set(files, paths);
		return paths;
	}

	private validateWorkspace() {
		const errors = this.findDuplicateProjectSeeds(this.#projectSeeds);
		if (errors.length > 0) {
			throw new WorkspaceConfigurationError(errors.join("\n"));
		}
	}

	private findDuplicateProjectSeeds(seeds: readonly ProjectSeed[]): string[] {
		const duplicates = collections.findDuplicatesByKey([...seeds], "name");
		return duplicates.map(
			([name, group]) =>
				`Duplicate project name "${name}" found at: ${group
					.map((seed) => seed.config?.projectDir ?? name)
					.join(", ")}`,
		);
	}
}
