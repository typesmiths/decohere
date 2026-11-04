import type {
	LoadFnOutput,
	LoadHookContext,
	ResolveFnOutput,
	ResolveHookContext,
} from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { injectable } from "@decohere/crucible/decorators";
import { BuildTargets, createWorkspace, SwcTranspiler } from "@decohere/forge";
import type { Project, Workspace } from "@decohere/workspace";
import { packageAliases, sourceExtensions } from "@decohere/workspace";
import { FileEx, io } from "@decohere/core/io";
import { type Logger, scribe } from "@decohere/scribe";
import { rewriteServeSpecifier } from "./rewrite-serve-specifier.js";
import { staticImports } from "./static-imports.js";
import { TranspileDiskCache } from "./transpile-disk-cache.js";

/** A source file flux compiles; `project` is undefined for a file outside every workspace package. */
type FileInfo = { project?: Project };
type SwcOptions = ReturnType<SwcTranspiler["createBaseConfig"]>;

export interface SourceModuleLoaderOptions {
	/** Build configuration name. */
	buildConfig: string;
	/**
	 * Pre-built Workspace instance to use instead of running WorkspaceFactory.
	 * Useful in tests to bypass filesystem-based workspace discovery.
	 */
	workspace?: Workspace;
	/**
	 * Map a watched `.ts` file URL for ESM resolution.
	 * Hot reload passes a `?version=` bust; one-shot run uses identity.
	 */
	versionFileUrl?: (fileUrl: string) => string;
	/** Optional post-resolve hook (e.g. dependency tracking for HMR). */
	onResolved?: (result: ResolveFnOutput, parentUrl: string) => void;
}

/**
 * Registers Node ESM resolve/load hooks and SWC-transpiles TypeScript on the fly: workspace
 * packages' files with their package's options, and any other source outside `node_modules`
 * (a script in a plain folder) with Forge's defaults. No file watching and no entry reboot — that belongs to
 * {@link HotReloadServer}.
 */
@injectable()
export class SourceModuleLoader {
	private readonly logger: Logger = scribe.logger(SourceModuleLoader.name);
	private readonly transpiler = new SwcTranspiler();
	private disposed = false;
	private hooksRegistered = false;
	private workspace?: Workspace;
	private buildConfig = "debug";
	private fileInfoMap = new Map<string, FileInfo>();
	private transpileCache = new Map<string, string>();
	/** Bumped when a file's cached code is dropped, so an up-front compile already running can't put it back. */
	private transpileVersions = new Map<string, number>();
	/** The source files each entry's walk reached, so a reboot only walks out from what changed. */
	private reachedFrom = new Map<string, Set<string>>();
	/** Compiled code on disk across runs; null when caching is off. */
	private diskCache: TranspileDiskCache | null = null;
	/** Up-front compiles in flight, shared by entries booting at the same time. */
	private compilingAhead = new Map<string, Promise<string | undefined>>();
	/** SWC options per project, built on first use and kept until the next `configure()`. */
	private swcConfigs = new Map<Project | undefined, SwcOptions>();
	private commonJsConfigs = new Map<Project | undefined, SwcOptions>();
	private aliasPaths: Record<string, string[]> = {};
	private aliasBaseUrl = path.resolve(".");
	private versionFileUrl: (fileUrl: string) => string = (fileUrl) => fileUrl;
	private onResolved?: (result: ResolveFnOutput, parentUrl: string) => void;

	public getWorkspace(): Workspace | undefined {
		return this.workspace;
	}

	public hasSourceFile(absolutePath: string): boolean {
		return this.fileInfoMap.has(absolutePath);
	}

	public sourceFilePaths(): IterableIterator<string> {
		return this.fileInfoMap.keys();
	}

	public setSourceFile(absolutePath: string, project: Project): void {
		this.fileInfoMap.set(absolutePath, { project });
	}

	public async configure(options: SourceModuleLoaderOptions): Promise<void> {
		this.disposed = false;
		// A new Map, not clear(): an up-front compile from before can't write into this one.
		this.transpileCache = new Map();
		this.reachedFrom = new Map();
		this.swcConfigs.clear();
		this.commonJsConfigs.clear();
		this.buildConfig = options.buildConfig;
		this.workspace = options.workspace ?? (await createWorkspace());
		this.versionFileUrl = options.versionFileUrl ?? ((fileUrl) => fileUrl);
		this.onResolved = options.onResolved;
		this.fileInfoMap = await this.buildFileInfoMap(this.buildConfig);
		this.diskCache = TranspileDiskCache.forWorkspace(this.workspace.rootDir);
		// In the background; it turns the cache off, with a warning, rather than throw.
		void this.diskCache?.pruneIfDue();
		const aliases = this.workspace.getPackageAliases(this.buildConfig);
		this.aliasBaseUrl = aliases.baseUrl;
		this.aliasPaths = aliases.paths;
	}

	public registerHooks(): void {
		if (this.hooksRegistered) return;
		this.hooksRegistered = true;
		// Compiled code carries inline source maps; Node only applies them to stack traces when
		// this is on. Without it, errors point at compiled line numbers.
		process.setSourceMapsEnabled(true);
		registerHooks({
			resolve: (
				specifier: string,
				context: ResolveHookContext,
				next: (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput,
			) => {
				if (this.disposed) return next(specifier, context);
				const parentUrl = context.parentURL ?? "";
				const rewritten =
					rewriteServeSpecifier({
						specifier,
						parentUrl,
						isWatchedTs: (filePath) => this.sourceInfo(filePath) != null,
						resolveBare: (bare) =>
							packageAliases.resolvePath(bare, this.aliasPaths, this.aliasBaseUrl),
						versionFileUrl: this.versionFileUrl,
					}) ?? specifier;
				const result = next(rewritten, context) as ResolveFnOutput;
				this.onResolved?.(result, parentUrl);
				return result;
			},
			load: (
				url: string,
				context: LoadHookContext,
				next: (url: string, context?: Partial<LoadHookContext>) => LoadFnOutput,
			): LoadFnOutput => {
				if (this.disposed) return next(url, context);
				const result = this.loadTs(url);
				if (result != null) {
					return { format: result.format, source: result.source, shortCircuit: true };
				}
				return next(url, context);
			},
		});
	}

	public async importEntry(absolutePath: string): Promise<unknown> {
		await this.compileAhead(path.resolve(absolutePath));
		const url = this.versionFileUrl(io.pathToFileUrl(path.resolve(absolutePath)));
		return import(url);
	}

	public invalidateTranspile(...absolutePaths: string[]): void {
		for (const fullPath of absolutePaths) {
			this.transpileCache.delete(fullPath);
			this.transpileVersions.set(fullPath, (this.transpileVersions.get(fullPath) ?? 0) + 1);
		}
	}

	public dispose(): void {
		this.disposed = true;
		this.transpileCache = new Map();
		this.reachedFrom = new Map();
		this.swcConfigs.clear();
		this.commonJsConfigs.clear();
		this.fileInfoMap.clear();
		this.workspace?.[Symbol.dispose]();
		this.workspace = undefined;
	}

	/**
	 * The file as a source flux compiles: a workspace package's file, or any other TypeScript
	 * source on disk outside `node_modules`, which Node would otherwise only strip of types, failing
	 * on enums, decorators and parameter properties. Null for everything else.
	 */
	private sourceInfo(fullPath: string): FileInfo | null {
		const fileInfo = this.fileInfoMap.get(fullPath);
		if (fileInfo != null) return fileInfo;
		const outsidePackages =
			sourceExtensions.isSource(fullPath) &&
			!fullPath.split(/[/\\]/).includes("node_modules") &&
			existsSync(fullPath);
		return outsidePackages ? {} : null;
	}

	private async buildFileInfoMap(buildConfig: string): Promise<Map<string, FileInfo>> {
		const projects = this.workspace?.getProjects(buildConfig) ?? [];
		const entries = await Promise.all(
			projects.map(async (project) => {
				const files = await project.getAllFiles();
				return files.map((file): [string, FileInfo] => [file.fullPath, { project }]);
			}),
		);
		return new Map(entries.flat());
	}

	/**
	 * Compiles the entry and the source files it imports, before Node imports it. The load
	 * hook is synchronous, so it would compile one file at a time on the main thread; async SWC
	 * runs on the thread pool. Walks out from the entry, compiling each file's imports in parallel,
	 * so files the app never imports (tests, other apps) are not compiled. A reboot walks out only
	 * from the files it reached before that are no longer cached (the saved ones), so their new
	 * imports are found without visiting the rest of the graph again.
	 *
	 * A file that fails here is left out of the cache instead of failing the boot: the load hook
	 * then compiles it again and throws as before, naming the file. The walk is a hint; whatever
	 * it misses is compiled by the load hook when Node gets to it.
	 */
	private async compileAhead(entryPath: string): Promise<void> {
		const reached = this.reachedFrom.get(entryPath);
		const starts =
			reached == null
				? [entryPath]
				: [...reached].filter((fullPath) => !this.transpileCache.has(fullPath));
		const seen = new Set(reached);
		for (const start of starts) seen.delete(start);
		const visit = async (fullPath: string): Promise<void> => {
			if (seen.has(fullPath)) return;
			seen.add(fullPath);
			const code = await this.compiledAhead(fullPath);
			if (code == null) return;
			const parentUrl = pathToFileURL(fullPath).toString();
			await Promise.all(
				staticImports.scan(code).map((specifier) => {
					const target = this.sourcePathOf(specifier, parentUrl);
					return target == null ? undefined : visit(target);
				}),
			);
		};
		await Promise.all(starts.map(visit));
		this.reachedFrom.set(entryPath, seen);
	}

	/** The file's compiled code, from the cache or compiled now; undefined if it isn't a source. */
	private compiledAhead(fullPath: string): Promise<string | undefined> {
		const fileInfo = this.sourceInfo(fullPath);
		if (fileInfo == null) return Promise.resolve(undefined);
		const cached = this.transpileCache.get(fullPath);
		if (cached != null) return Promise.resolve(cached);
		const inFlight = this.compilingAhead.get(fullPath);
		if (inFlight != null) return inFlight;

		const version = this.transpileVersions.get(fullPath);
		const cache = this.transpileCache;
		const compiling = this.compileAsync(fullPath, fileInfo.project)
			.then((code) => {
				if (code == null) return undefined;
				// Saved, reconfigured or disposed while compiling: don't cache stale code.
				const current =
					!this.disposed &&
					cache === this.transpileCache &&
					version === this.transpileVersions.get(fullPath);
				if (current) cache.set(fullPath, code);
				return code;
			})
			.finally(() => this.compilingAhead.delete(fullPath));
		this.compilingAhead.set(fullPath, compiling);
		return compiling;
	}

	/** The source file a specifier names, mapped the way the resolve hook maps it. */
	private sourcePathOf(specifier: string, parentUrl: string): string | null {
		const url = rewriteServeSpecifier({
			specifier,
			parentUrl,
			isWatchedTs: (filePath) => this.sourceInfo(filePath) != null,
			resolveBare: (bare) =>
				packageAliases.resolvePath(bare, this.aliasPaths, this.aliasBaseUrl),
			versionFileUrl: (fileUrl) => fileUrl,
		});
		return url == null ? null : fileURLToPath(url);
	}

	private loadTs(url: string): { source: string; format: "module" | "commonjs" } | null {
		if (!url.startsWith("file:")) return null;

		// fileURLToPath, not URL.pathname: decodes %20 and gives Windows paths, so files
		// whose path has a space still match the workspace's package list.
		const cleanPath = fileURLToPath(url);
		const fileInfo = this.sourceInfo(cleanPath);
		if (fileInfo == null) return null;

		const format = sourceExtensions.isCommonJs(cleanPath) ? "commonjs" : "module";
		const cached = this.transpileCache.get(cleanPath);
		if (cached != null) return { source: cached, format };

		const code = this.compileSync(cleanPath, fileInfo.project);
		this.transpileCache.set(cleanPath, code);
		return { source: code, format };
	}

	/**
	 * Compiles a file for the load hook, through the disk cache. Throws, naming the file,
	 * when it can't be read or doesn't compile.
	 */
	private compileSync(fullPath: string, project: Project | undefined): string {
		const file = new FileEx({ fullPath });
		const baseConfig = this.swcConfigFor(project, fullPath);
		let source: string;
		try {
			source = readFileSync(fullPath, "utf8");
		} catch (error) {
			this.logger.error(`Failed to transpile ${fullPath}`, error);
			throw new Error(`Failed to transpile ${fullPath}`, { cause: error });
		}
		const key = this.diskCache?.keyFor(fullPath, source, baseConfig);
		const hit = key == null ? undefined : this.diskCache?.readSync(key);
		if (hit != null) return hit;

		const response = this.transpiler.transformCodeSync(
			source,
			file,
			BuildTargets.es6,
			baseConfig,
		);
		if (response.outcome !== "success") {
			this.logger.error(`Failed to transpile ${fullPath}`, response);
			throw new Error(`Failed to transpile ${fullPath}`);
		}
		if (key != null) this.diskCache?.writeSync(key, response.code);
		return response.code;
	}

	/**
	 * Compiles a file ahead, through the disk cache; undefined when it doesn't compile, which the
	 * load hook then reports (see {@link compileAhead}). The source and the cache entry are read
	 * synchronously: for small files that is far cheaper than a trip through libuv's thread pool,
	 * which async SWC needs for the compiles that miss.
	 */
	private async compileAsync(
		fullPath: string,
		project: Project | undefined,
	): Promise<string | undefined> {
		const file = new FileEx({ fullPath });
		const baseConfig = this.swcConfigFor(project, fullPath);
		let source: string;
		try {
			source = readFileSync(fullPath, "utf8");
		} catch {
			// Left to the load hook, which reads it again and fails naming it, as for a file
			// that doesn't compile.
			return undefined;
		}
		const key = this.diskCache?.keyFor(fullPath, source, baseConfig);
		const hit = key == null ? undefined : this.diskCache?.readSync(key);
		if (hit != null) return hit;

		const response = await this.transpiler.transformCode(
			source,
			file,
			BuildTargets.es6,
			baseConfig,
		);
		if (response.outcome !== "success") return undefined;
		if (key != null) await this.diskCache?.write(key, response.code);
		return response.code;
	}

	/**
	 * The project's SWC options, built once: rebuilding them for every file was about a quarter
	 * of load time. Import specifiers are left as written, without `jsc.paths` or
	 * `resolveFully`: the resolve hook maps them to source files (aliases, `.js` to `.ts`,
	 * directory indexes), so SWC does not resolve them a second time against the disk.
	 */
	private swcConfigFor(project: Project | undefined, fullPath: string): SwcOptions {
		const config = this.esModuleConfigFor(project);
		if (!sourceExtensions.isCommonJs(fullPath)) return config;
		// `.cts` is CommonJS: Node loads it with `require` semantics, so SWC emits CommonJS.
		// Kept per project, like the ES module options, so the disk cache hashes them once.
		const cached = this.commonJsConfigs.get(project);
		if (cached != null) return cached;
		const commonJs: SwcOptions = { ...config, module: { type: "commonjs" } };
		this.commonJsConfigs.set(project, commonJs);
		return commonJs;
	}

	/** Forge's defaults when there is no project: decorators and their metadata on. */
	private esModuleConfigFor(project: Project | undefined): SwcOptions {
		const cached = this.swcConfigs.get(project);
		if (cached != null) return cached;
		const base = this.transpiler.createBaseConfig(BuildTargets.es6, {
			tsConfig: project?.getTsConfigSync(),
			userConfig: project?.getSwcConfigSync(),
			aliasPaths: false,
			workspace: this.workspace,
		});
		// `module` is the ES module config (`type: "es6"` above); the spread loses the narrowing.
		const module = { ...base.module, resolveFully: false } as SwcOptions["module"];
		const config: SwcOptions = { ...base, module };
		this.swcConfigs.set(project, config);
		return config;
	}
}
