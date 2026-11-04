import type { Project, Workspace } from "@decohere/workspace";
import type { FileEx } from "@decohere/core/io";
import type { Observable } from "@decohere/core/system";
import type { BuildTarget } from "../types/build-target.type.js";
import type { TransformResponse } from "./transform-response.model.js";

export const TransformerKey = Symbol("TransformerKey");
export interface Transformer {
	readonly buildTargets: BuildTarget[];

	/**
	 * Optional pre-build phase that runs sequentially before all transformers'
	 * {@link transformProject} calls. Use for expensive CPU-bound setup (e.g.
	 * TypeScript createProgram) that must not compete with other transformers'
	 * parallel workloads.
	 */
	init?(
		projects: Project | Project[],
		fileFilter?: (project: Project) => Promise<FileEx[]>,
	): Promise<void>;

	transformProject(
		projects: Project | Project[],
		fileFilter?: (project: Project) => Promise<FileEx[]>,
		onOutput?: (response: TransformResponse) => void,
	): Promise<TransformResponse[]>;

	/**
	 * If implemented, signals this transformer supports incremental (watch) mode.
	 * {@link BuildAction} calls this after the initial build, passing the workspace
	 * so the transformer can self-subscribe to file change events.
	 */
	watch?(workspace: Workspace): void;

	/**
	 * Emits incremental transform results after each file-change cycle.
	 * Present when {@link watch} is implemented.
	 */
	incrementalTransform$?: Observable<TransformResponse[]>;
}
