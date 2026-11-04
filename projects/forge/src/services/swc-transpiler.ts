import path from "node:path";
import {
	type Project,
	type ProjectFileEvent,
	sourceExtensions,
	type Tsconfig,
	type Workspace,
} from "@decohere/workspace";
import { cache, invalidateCache } from "@decohere/core/caching";
import { Trace } from "@decohere/devkit/diagnostics";
import type { FileEx } from "@decohere/core/io";
import { WatchEvents } from "@decohere/devkit/io";
import { type Options, transform, transformSync } from "@swc/core";
import type { Observable } from "@decohere/core/system";
import {
	type BuildTarget,
	BuildTargets,
	type TranspileTarget,
} from "../types/build-target.type.js";
import "../extensions/project.extensions.js";
import { SwcConfigFactory } from "../factories/swc-config.factory.js";
import type { SwcConfig } from "../types/swc-config.type.js";
import { TransformResponse } from "../types/transform-response.model.js";
import type { Transformer } from "../types/transformer.type.js";
import { IncrementalWatch } from "./incremental-watch.js";
import { OutputCache } from "./output-cache.js";

export type TranspileOptions = {
	aliasPaths?: boolean;
	sourceMaps?: boolean;
	tsConfig?: Tsconfig;
	userConfig?: SwcConfig;
	workspace?: Workspace;
	projects?: readonly Project[];
};

@Trace
export class SwcTranspiler implements Transformer {
	public buildTargets: BuildTarget[] = [BuildTargets.es6, BuildTargets.commonjs];
	#swcConfigFactory = new SwcConfigFactory();
	#workspace?: Workspace;
	readonly #outputs = new OutputCache();
	readonly #incremental = new IncrementalWatch();

	public get incrementalTransform$(): Observable<TransformResponse[]> {
		return this.#incremental.results$;
	}

	public watch(workspace: Workspace): void {
		this.#workspace = workspace;
		this.#incremental.watch(workspace, (evt) => this.onIncrementalFileEvent(evt));
	}

	private withAliasContext(options: TranspileOptions = {}): TranspileOptions {
		return {
			...options,
			workspace: options.workspace ?? this.#workspace,
		};
	}

	public async transformProject(
		projectArrayLike: Project | Project[],
		fileFilter?: (project: Project) => Promise<FileEx[]>,
		onOutput?: (response: TransformResponse) => void,
	): Promise<TransformResponse[]> {
		const projects = Array.isArray(projectArrayLike) ? projectArrayLike : [projectArrayLike];
		const responses = await Promise.all(
			projects.map(async (project) => {
				const { targets, aliasPaths, sourceMaps } = project.getForgeConfiguration();
				const transpileTargets = targets.filter((bt) => bt !== BuildTargets.types);
				if (transpileTargets.length === 0) {
					return [];
				}

				const sourceFiles = await (fileFilter?.(project) ?? project.getAllFiles());
				const tsConfig = await project.getTsConfig();
				const userConfig = await project.getSwcConfig();
				const responses = await Promise.all(
					transpileTargets.map((target) => {
						return this.transformTarget(
							sourceFiles,
							target,
							{
								tsConfig,
								userConfig,
								aliasPaths,
								sourceMaps,
								workspace: this.#workspace,
								projects,
							},
							project,
							onOutput,
						);
					}),
				);
				return responses.flat();
			}),
		);

		const flat = responses.flat();
		this.#outputs.record(flat);
		return flat;
	}

	/**
	 * The SWC options for one project and target, without a filename. Building them reads the
	 * workspace's aliases and merges configs, so a caller that transpiles many files builds them
	 * once and passes them to {@link transformCode}.
	 */
	public createBaseConfig(
		buildTarget: TranspileTarget,
		options: TranspileOptions = {},
	): Options {
		return this.#swcConfigFactory.createBaseConfig(
			buildTarget,
			this.withAliasContext(options),
		);
	}

	/** Sync variant of {@link transformCode}, for the load hook, which cannot await. */
	public transformCodeSync(
		content: string,
		file: FileEx,
		buildTarget: TranspileTarget,
		baseConfig: Options,
	): TransformResponse {
		const swcOptions = this.#swcConfigFactory.createFileConfig(file, baseConfig);
		if (content === "") return SwcTranspiler.skippedEmpty(file, swcOptions);

		try {
			const transformed = transformSync(content, swcOptions);
			if (transformed == null) {
				throw new Error("swc.transformSync returned no result");
			}
			return SwcTranspiler.succeeded(file, buildTarget, swcOptions, content, transformed.code);
		} catch (error) {
			return TransformResponse.Error({ file, messages: [String(error)], config: swcOptions });
		}
	}

	/**
	 * Compiles `content` as the source of `file`, without reading the file: for callers that
	 * already hold the code, such as the Vitest plugin, which must compile what Vite passes it
	 * rather than an earlier read of the disk. Async SWC, on the thread pool, so many
	 * calls in flight compile in parallel. With a `project`, the response carries where
	 * the build writes the output.
	 */
	public async transformCode(
		content: string,
		file: FileEx,
		buildTarget: TranspileTarget,
		baseConfig: Options,
		project?: Project,
	): Promise<TransformResponse> {
		const swcOptions = this.#swcConfigFactory.createFileConfig(file, baseConfig);
		if (content === "") return SwcTranspiler.skippedEmpty(file, swcOptions, project);

		try {
			const transformed = await transform(content, swcOptions);
			if (transformed == null) {
				throw new Error("swc.transform returned no result");
			}
			return SwcTranspiler.succeeded(
				file,
				buildTarget,
				swcOptions,
				content,
				transformed.code,
				project,
			);
		} catch (error) {
			return TransformResponse.Error({
				file,
				messages: [String(error)],
				config: swcOptions,
				project,
			});
		}
	}

	private static skippedEmpty(
		file: FileEx,
		swcOptions: Options,
		project?: Project,
	): TransformResponse {
		return TransformResponse.Skipped({
			file,
			messages: "File is empty",
			config: swcOptions,
			project,
		});
	}

	private static succeeded(
		file: FileEx,
		buildTarget: TranspileTarget,
		swcOptions: Options,
		content: string,
		code: string,
		project?: Project,
	): TransformResponse {
		const fileName = sourceExtensions.outputPath(file.relativePath);
		const outBaseDir = project?.getOutDir(buildTarget);
		const outputPath = outBaseDir ? path.join(outBaseDir, fileName) : undefined;
		return TransformResponse.Success({
			file,
			code,
			sourceContent: content,
			target: buildTarget,
			fileName,
			outputDir: outputPath ? path.dirname(outputPath) : undefined,
			outputPath,
			config: swcOptions,
			project,
		});
	}

	private async transformTarget(
		files: FileEx[],
		buildTarget: TranspileTarget,
		options: TranspileOptions,
		project: Project,
		onOutput?: (response: TransformResponse) => void,
	) {
		const baseConfig = this.createBaseConfig(buildTarget, options);
		return await Promise.all(
			files.map(async (file) => {
				const content = await this.getFileContent(file);
				const response = await this.transformCode(
					content,
					file,
					buildTarget,
					baseConfig,
					project,
				);
				onOutput?.(response);
				return response;
			}),
		);
	}

	private async onIncrementalFileEvent(evt: ProjectFileEvent): Promise<TransformResponse[]> {
		const { file, project } = evt;
		if (evt.eventName === WatchEvents.unlink) {
			this.#outputs.delete(file.fullPath);
			return [];
		}
		if (!project.isSourceFile(file)) {
			return [];
		}
		const freshContent = await file.getContent();
		const cached = this.#outputs.get(file.fullPath);
		if (cached != null && cached[0]?.sourceContent === freshContent) {
			return [];
		}
		this.invalidateContentCache(file);
		return this.transformProject(project, () => Promise.resolve([file]));
	}

	@invalidateCache(SwcTranspiler.prototype.getFileContent, {
		name: "FILE_CONTENT",
		keyFn: (...args) => (args[0] as FileEx).fullPath,
	})
	public invalidateContentCache(_file: FileEx): void {}

	@cache({ name: "FILE_CONTENT", keyFn: (...args) => (args[0] as FileEx).fullPath })
	private async getFileContent(file: FileEx): Promise<string> {
		return await file.getContent();
	}
}
