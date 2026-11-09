import { inject, injectable } from "@decohere/crucible/decorators";
import type { Project } from "@decohere/workspace";
import { Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { Trace } from "@decohere/devkit/diagnostics";
import type { FileEx } from "@decohere/core/io";
import { scribe } from "@decohere/scribe";
import { ForgeError } from "../errors.js";
import { runOwnScripts } from "../services/own-scripts.js";
import { FileWriterService } from "../services/file-writer.service.js";
import type { TransformResponse } from "../types/transform-response.model.js";
import { type Transformer, TransformerKey } from "../types/transformer.type.js";

export type BuildOptions = {
	build?: boolean;
	configuration: string;
	file: string;
};

@Trace
@injectable()
export class Build implements Action<BuildOptions> {
	#logger = scribe.logger(Build.name);
	public constructor(
		private readonly workspace: Workspace,
		@inject(TransformerKey) private readonly transformers: Transformer[],
		private readonly fileWriter: FileWriterService,
	) {
		if (!transformers || transformers.length === 0) {
			throw new ForgeError("At least one transformer is required");
		}
	}

	public run = async (options: BuildOptions): Promise<ActionResponse<TransformResponse>> => {
		if (options.build === false) {
			this.#logger.info("Skipping build");
			return ActionResponse.Skipped(Build.name) as ActionResponse<TransformResponse>;
		}
		const { configuration: buildConfig } = options;
		const projects = this.workspace.getProjects(buildConfig);
		const compiled = projects.filter((project) => project.ownScript("build") == null);
		void this.fileWriter.warmup(compiled);
		const transformResults = compiled.length > 0 ? await this.build(compiled) : [];

		const errors = transformResults.filter((response) => response.outcome === "failure");
		if (errors.length > 0) {
			const messages = transformResults.map((responses) => responses.messages).join("\n");
			throw new ForgeError(`Error building: ${messages}`);
		}
		// Projects with a builder of their own (Astro, Vite) build with their `build` script: their
		// builder writes its output where its config says.
		await runOwnScripts(
			projects.filter((project) => project.ownScript("build") != null),
			{
				script: "build",
				verb: "Building",
				workspaceRoot: this.workspace.rootDir,
				logger: this.#logger,
			},
		);

		for (const transformer of this.transformers) {
			if (transformer.watch && transformer.incrementalTransform$) {
				transformer.watch(this.workspace);
				transformer.incrementalTransform$.subscribe((responses) => {
					this.fileWriter.enqueueOutputs(responses);
					void this.writeOutput();
					const succeeded = responses.some((r) => r.outcome === "success");
					if (succeeded) {
						this.#logger.info(`Transpiled ${responses[0].file.fullPath}`);
					}
				});
			}
		}

		return ActionResponse.Success(Build.name, transformResults);
	};

	public async build(
		projectArrayLike: readonly Project[] | Project,
	): Promise<TransformResponse[]> {
		const projects: Project[] = Array.isArray(projectArrayLike)
			? projectArrayLike
			: [projectArrayLike];
		for (const project of projects) {
			this.#logger.info(`Building ${project.name}`);
		}
		return this.runTransformers(projects);
	}

	private async runTransformers(
		projects: Project | Project[],
		fileFilter?: (project: Project) => Promise<FileEx[]>,
	) {
		// Phase 1: sequential init — runs expensive setup (e.g. TypeScript createProgram)
		// before any transformer's parallel workload (e.g. SWC/Rayon) starts.
		for (const transformer of this.transformers) {
			await transformer.init?.(projects, fileFilter);
		}
		// Phase 2: parallel transform — all transformers run concurrently now that
		// CPU-heavy init is complete.
		const allResponses = (
			await Promise.all(
				this.transformers.map((t) =>
					t.transformProject(projects, fileFilter, (response) => {
						this.fileWriter.enqueueOutput(response);
					}),
				),
			)
		).flat();
		await this.writeOutput();
		return allResponses;
	}

	private async writeOutput() {
		await this.fileWriter.flush();
	}
}
