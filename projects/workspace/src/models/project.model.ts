import { existsSync } from "node:fs";
import path from "node:path";
import { cache, memoize } from "@decohere/core/caching";
import { mixwith } from "@decohere/core/extensibility";
import type { FileEx, Watcher } from "@decohere/core/io";
import {
	findFiles,
	type WatchEventName,
	WatchEvents,
	watch as watchDirectory,
} from "@decohere/devkit/io";
import picomatch from "picomatch";
import { Subject } from "@decohere/core/system";
import { WorkspaceConfigurationError } from "../errors.js";
import { HasPackageJson } from "./has-package-json.mixin.js";
import { HasTsConfig } from "./has-tsconfig.mixin.js";
import { type PackageExports, PackageJson } from "./package-json.model.js";
import { projectScripts } from "./project-scripts.js";
import type { ProjectFileEvent } from "./project-file-event.js";
import { sourceExtensions } from "./source-extensions.js";
import type { Configuration, WorkspaceOptions } from "./workspace-config.type.js";

export type ProjectConfig = {
	projectDir?: string;
	packageJson?: PackageJson;
} & WorkspaceOptions;

export type ProjectSeed = {
	name: string;
	config?: ProjectConfig;
};

export class Project extends mixwith(HasPackageJson, HasTsConfig) {
	protected packageJson?: PackageJson;
	readonly #projectFileChangedSubject = new Subject<ProjectFileEvent>();
	readonly #sourceFiles = new Map<string, FileEx>();
	readonly #projectConfig: ProjectConfig;
	readonly #name: string;
	readonly #projectDirectory: string;
	readonly #selectedConfiguration: Configuration;
	#hasLoadedSourceFiles = false;
	#watcher?: Watcher;

	public constructor(
		name: string,
		config: ProjectConfig = {} as ProjectConfig,
		selectedConfigurationName?: string,
	) {
		super();
		this.#name = name;
		this.#projectDirectory = config?.projectDir ?? name;
		this.#projectConfig = config;
		this.#selectedConfiguration = this.resolveConfiguration(selectedConfigurationName);
		this.packageJson = config.packageJson ?? new PackageJson();
	}

	public get name() {
		return this.#name;
	}

	/**
	 * The command of this project's own script for a step, when it has one that doesn't call a
	 * Decohere tool: forge and flux run it in the project's folder instead of doing the step.
	 */
	public ownScript(name: string): string | undefined {
		return projectScripts.own(this.packageJson?.scripts, name);
	}

	public get isPrivate() {
		return this.packageJson?.private === true;
	}

	public toString() {
		return `Project(${this.#name})`;
	}

	public get projectDirectory() {
		return this.#projectDirectory;
	}

	public get projectRoot() {
		return path.resolve(this.#projectConfig.rootDir ?? "./", this.#projectDirectory);
	}

	public get configuration() {
		return this.#selectedConfiguration;
	}

	protected get packageJsonDirectory(): string {
		return this.#absoluteProjectDir;
	}

	protected get tsConfigDirectory(): string {
		return this.#absoluteProjectDir;
	}

	protected get fallbackTsConfigDirectory(): string | undefined {
		return this.#projectConfig.rootDir;
	}

	public get rootDir(): string {
		return this.#projectConfig.rootDir ?? "./";
	}

	get #absoluteProjectDir(): string {
		return this.projectRoot;
	}

	public get include() {
		return this.#selectedConfiguration.include ?? this.#projectConfig.include ?? [];
	}

	public get ignore() {
		const baseIgnore = this.#projectConfig.ignore ?? [];
		const selectedIgnore = this.#selectedConfiguration.ignore ?? [];
		return [...baseIgnore, ...selectedIgnore];
	}

	public get copyFiles() {
		const base = this.#projectConfig.copyFiles ?? [];
		const selected = this.#selectedConfiguration.copyFiles ?? [];
		return [...base, ...selected];
	}

	public get dockerConfig() {
		return this.#projectConfig.docker;
	}

	public get uiConfig() {
		return this.#projectConfig.ui;
	}

	public get configurations(): Configuration[] {
		return this.#projectConfig.configurations ?? [];
	}

	public get projectFileChanged$() {
		return this.#projectFileChangedSubject.asObservable();
	}

	@memoize()
	public async getAllFiles() {
		const files = await findFiles(this.include, {
			cwd: this.#absoluteProjectDir,
			ignore: this.ignore,
		});

		this.#sourceFiles.clear();
		for (const file of files) {
			this.#sourceFiles.set(file.relativePath, file);
		}
		this.#hasLoadedSourceFiles = true;
		return files;
	}

	public isSourceFile(file: FileEx) {
		return this.#sourceFiles.has(file.relativePath);
	}

	public async watch(configuration: string) {
		if (this.#watcher != null) {
			return this.#watcher;
		}

		if (!this.#hasLoadedSourceFiles) {
			await this.getAllFiles();
		}

		const watcher = watchDirectory(this.#absoluteProjectDir, { ignoreInitial: true });
		this.#watcher = watcher;

		watcher.on(WatchEvents.add, (file) => {
			const fileEx = file as FileEx;
			this.updateSourceFileCache(WatchEvents.add, fileEx);
			this.#projectFileChangedSubject.next({
				project: this,
				configuration,
				eventName: WatchEvents.add,
				file: fileEx,
			});
		});

		watcher.on(WatchEvents.change, (file) => {
			const fileEx = file as FileEx;
			this.updateSourceFileCache(WatchEvents.change, fileEx);
			this.#projectFileChangedSubject.next({
				project: this,
				configuration,
				eventName: WatchEvents.change,
				file: fileEx,
			});
		});

		watcher.on(WatchEvents.unlink, (file) => {
			const fileEx = file as FileEx;
			this.updateSourceFileCache(WatchEvents.unlink, fileEx);
			this.#projectFileChangedSubject.next({
				project: this,
				configuration,
				eventName: WatchEvents.unlink,
				file: fileEx,
			});
		});

		return watcher;
	}

	public stopWatching() {
		this.#watcher?.close();
		this.#watcher = undefined;
	}

	@cache()
	public getRootOut() {
		return path.join(this.getWorkspaceOut(), this.#selectedConfiguration.name);
	}

	@cache()
	public getOutDir(target = "") {
		const targetDir = this.#selectedConfiguration.pack
			? path.join(this.projectDirectory, target)
			: path.join(this.projectDirectory);

		const out = path.join(this.getRootOut(), targetDir);
		return out;
	}

	public getConfiguration(name: string) {
		return this.configurations.find((b) => b.name === name);
	}

	/**
	 * The package's entry source file. A TypeScript `main` (the workspace convention,
	 * `src/index.ts`) is used as written. A `main` or `exports["."]` that describes the published
	 * layout (`index.js`, `./es6/src/index.js`) is mapped back to the source it was built from,
	 * falling back to `src/index.ts`.
	 */
	public getSourceEntryPath(): string {
		const projectRoot = path.join(this.rootDir, this.projectDirectory);
		const main = this.packageJson?.main;
		if (main != null && sourceExtensions.isSource(main)) {
			return path.join(projectRoot, main);
		}
		const exports = this.packageJson?.exports;
		const root =
			exports == null
				? undefined
				: typeof exports === "string"
					? exports
					: (exports["."] ??
						(Object.keys(exports).some((k) => k.startsWith(".")) ? undefined : exports));
		for (const built of [root == null ? undefined : firstExportTarget(root), main]) {
			const fromSrc = built?.match(/(?:^|\/)(src\/.+)$/)?.[1];
			const source =
				fromSrc == null ? undefined : sourceFileFor(path.join(projectRoot, fromSrc));
			if (source != null) return source;
		}
		const conventional = path.join(projectRoot, "src/index.ts");
		if (main == null || existsSync(conventional)) return conventional;
		return path.join(projectRoot, main);
	}

	/**
	 * The source file each subpath in package.json `exports` names, such as `./auth` →
	 * `<project>/src/auth/auth.extensions.ts`. Exports point at the release layout
	 * (`./es6/src/auth/auth.extensions.js`); the source is the part from `src/`, with its
	 * TypeScript extension. Wildcard subpaths, and targets with no such source file, are left out.
	 */
	public getSourceExports(): Record<string, string> {
		const exports = this.packageJson?.exports;
		if (exports == null || typeof exports === "string") return {};
		const projectRoot = path.join(this.rootDir, this.projectDirectory);
		const sources: Record<string, string> = {};
		for (const [subpath, target] of Object.entries(exports)) {
			if (!subpath.startsWith("./") || subpath.includes("*")) continue;
			const built = firstExportTarget(target);
			const fromSrc = built?.match(/(?:^|\/)(src\/.+)$/)?.[1];
			if (fromSrc == null) continue;
			const source = sourceFileFor(path.join(projectRoot, fromSrc));
			if (source != null) sources[subpath] = source;
		}
		return sources;
	}

	public [Symbol.dispose]() {
		this.stopWatching();
	}

	private getWorkspaceOut() {
		const out = path.join(this.#projectConfig.rootDir ?? "./", this.#projectConfig.outDir);
		return out;
	}

	private updateSourceFileCache(eventName: WatchEventName, file: FileEx) {
		if (!this.#hasLoadedSourceFiles) {
			return;
		}

		switch (eventName) {
			case WatchEvents.unlink:
				this.#sourceFiles.delete(file.relativePath);
				return;
			case WatchEvents.add:
			case WatchEvents.change:
				if (this.matchesSourcePattern(file.relativePath)) {
					this.#sourceFiles.set(file.relativePath, file);
					return;
				}

				this.#sourceFiles.delete(file.relativePath);
				return;
		}
	}

	private matchesSourcePattern(relativePath: string) {
		if (picomatch.isMatch(relativePath, this.ignore)) {
			return false;
		}

		return picomatch.isMatch(relativePath, this.include);
	}

	private resolveConfiguration(configurationName?: string): Configuration {
		const resolvedConfigurationName = configurationName ?? "debug";

		const configuration = this.configurations.find(
			(c) => c.name === resolvedConfigurationName,
		);
		if (configuration == null) {
			throw new WorkspaceConfigurationError(
				`Configuration "${resolvedConfigurationName}" was not found for project "${this.name}"`,
			);
		}

		return configuration;
	}
}

/** The first path an exports value gives, preferring the conditions that name runtime code. */
function firstExportTarget(value: PackageExports): string | undefined {
	if (typeof value === "string") return value;
	for (const condition of ["import", "default", "require", "node", "types"]) {
		const nested = value[condition];
		if (nested != null) return firstExportTarget(nested);
	}
	return undefined;
}

/** The TypeScript source a built or declaration path came from, if it exists. */
function sourceFileFor(builtPath: string): string | undefined {
	// A declaration names the file its JavaScript sits next to: `x.d.ts` is `x.js`.
	const declaration = builtPath.match(/^(.*)\.d\.([mc]?)ts$/);
	const built = declaration == null ? builtPath : `${declaration[1]}.${declaration[2]}js`;
	return sourceExtensions.candidates(built).find((candidate) => existsSync(candidate));
}
