import path from "node:path";
import type { Project, ProjectFileEvent, Tsconfig, Workspace } from "@decohere/workspace";
import { invalidateCache } from "@decohere/core/caching";
import { Trace } from "@decohere/devkit/diagnostics";
import type { FileEx } from "@decohere/core/io";
import { WatchEvents } from "@decohere/devkit/io";
import type { Observable } from "@decohere/core/system";
import type ts from "typescript";
import "../extensions/project.extensions.js";
import { IncrementalWatch } from "../services/incremental-watch.js";
import { OutputCache } from "../services/output-cache.js";
import { tsCompilerOptions } from "../services/ts-compiler-options.js";
import { TsProgramHost } from "../services/ts-program-host.js";
import {
	TypeEmissionProgram,
	type TypeProgramProject,
} from "../services/type-emission-program.js";
import { type BuildTarget, BuildTargets } from "../types/build-target.type.js";
import type { TransformResponse } from "../types/transform-response.model.js";
import type { Transformer } from "../types/transformer.type.js";

/**
 * Compiler option defaults applied before the user's tsconfig — the user's values override these.
 *
 * lib: ES2022 — avoids loading lib.dom.d.ts (1.8 MB) which TS includes by default
 * when no `lib` is set. Backend packages have no use for browser APIs.
 *
 * types: [] — disables ambient @types auto-discovery. Without this, TS scans
 * every @types/* package in the node_modules hierarchy; in a monorepo that can
 * pull in dozens of unrelated packages. Explicitly imported types still resolve
 * normally; only ambient globals (e.g. Buffer, process) are suppressed — add
 * `types: ["node"]` to a project's tsconfig to restore them.
 */
export const DEFAULT_TYPE_EMITTER_OPTIONS: Readonly<ts.CompilerOptions> = {
	lib: ["lib.es2022.d.ts"],
	types: [],
	skipLibCheck: true,
};

/**
 * A project with a tsconfig of its own (a site, a browser library) has chosen its settings, so
 * what it leaves out means what it means to plain tsc: `lib` from its `target` (with the DOM),
 * `types` as TypeScript finds them. These unset forge's faster defaults under it.
 */
const TSC_DEFAULTS: Readonly<ts.CompilerOptions> = { lib: undefined, types: undefined };

/** The project's tsconfig is in its own folder, not the workspace's it falls back to. */
function hasOwnTsconfig(project: Project, tsconfig: Tsconfig): boolean {
	return (
		tsconfig.filePath != null &&
		path.dirname(path.resolve(tsconfig.filePath)) === path.resolve(project.projectRoot)
	);
}

/**
 * Compiler options that TypeEmitter always enforces regardless of what the user's
 * tsconfig specifies. Applied after the user spread so they cannot be overridden.
 */
export const REQUIRED_TYPE_EMITTER_OPTIONS: Readonly<ts.CompilerOptions> = {
	emitDeclarationOnly: true,
	declaration: true,
};

/** Compiler options enforced for `forge typecheck` — never emit JS or declarations. */
export const REQUIRED_TYPE_CHECK_OPTIONS: Readonly<ts.CompilerOptions> = {
	noEmit: true,
};

export type PrepareProgramsOptions = {
	includeAllProjects?: boolean;
	requiredCompilerOptions?: ts.CompilerOptions;
};

@Trace
export class TypeEmitter implements Transformer {
	public buildTargets: BuildTarget[] = [BuildTargets.types];
	/** Prepared programs from init(), consumed once by the next transformProject() call. */
	#programs: TypeEmissionProgram[] | undefined;
	#host = new TsProgramHost();
	readonly #outputs = new OutputCache();
	readonly #incremental = new IncrementalWatch();

	public get incrementalTransform$(): Observable<TransformResponse[]> {
		return this.#incremental.results$;
	}

	public watch(workspace: Workspace): void {
		this.#incremental.watch(workspace, (evt) => this.onIncrementalFileEvent(evt));
	}

	/**
	 * Phase 1: fetch files, create TypeScript programs sequentially.
	 * Called before transformProject() so that the heavy createProgram work
	 * completes before other transformers (SWC/Rayon) start running in parallel.
	 */
	public async init(
		projectArrayLike: Project[] | Project,
		_filter?: (project: Project) => Promise<FileEx[]>,
	): Promise<void> {
		if (this.#programs == null) {
			this.#programs = await this.preparePrograms(projectArrayLike);
		}
	}

	public async transformProject(
		projectArrayLike: Project[] | Project,
		filter?: (project: Project) => Promise<FileEx[]>,
		onOutput?: (response: TransformResponse) => void,
	): Promise<TransformResponse[]> {
		// Consume prepared state from init() if available; otherwise do full setup
		// (e.g. watch-mode single-file rebuilds that skip the init phase).
		const programs = this.#programs ?? (await this.preparePrograms(projectArrayLike));
		this.#programs = programs;

		if (programs.length === 0) {
			return [];
		}

		const responses = (
			await Promise.all(programs.map((program) => program.emit(filter, onOutput)))
		).flat();
		this.#outputs.record(responses);
		return responses;
	}

	/**
	 * Type-check projects without emitting files. Includes every workspace project, not
	 * only those with a `types` build target (debug is es6-only).
	 */
	public async checkProject(
		projectArrayLike: Project[] | Project,
	): Promise<{ diagnostics: ts.Diagnostic[]; formatted: string }> {
		const programs = await this.preparePrograms(projectArrayLike, {
			includeAllProjects: true,
			requiredCompilerOptions: REQUIRED_TYPE_CHECK_OPTIONS,
		});
		const diagnostics: ts.Diagnostic[] = [];
		const formattedParts: string[] = [];
		for (const program of programs) {
			const programDiagnostics = program.check();
			if (programDiagnostics.length === 0) {
				continue;
			}
			diagnostics.push(...programDiagnostics);
			formattedParts.push(program.formatDiagnostics(programDiagnostics));
		}
		return { diagnostics, formatted: formattedParts.join("") };
	}

	private async preparePrograms(
		projectArrayLike: Project[] | Project,
		options: PrepareProgramsOptions = {},
	): Promise<TypeEmissionProgram[]> {
		const allProjects = Array.isArray(projectArrayLike)
			? projectArrayLike
			: [projectArrayLike];
		const projects = options.includeAllProjects
			? allProjects
			: allProjects.filter((proj) =>
					proj.getForgeConfiguration().targets.includes(BuildTargets.types),
				);
		if (projects.length === 0) {
			return [];
		}

		// Pre-fetch all files and tsconfigs in parallel across all projects
		const projectData: TypeProgramProject[] = await Promise.all(
			projects.map(async (proj) => {
				const tsconfig = await proj.getTsConfig();
				const compilerOptions = tsCompilerOptions(tsconfig);
				return {
					project: proj,
					files: await proj.getAllFiles(),
					tsconfig,
					compilerOptions: hasOwnTsconfig(proj, tsconfig)
						? { ...TSC_DEFAULTS, ...compilerOptions }
						: compilerOptions,
				};
			}),
		);

		// Group projects by the resolved compiler options that affect the compiler
		// host (lib loading, module resolution, path aliases). Projects sharing the
		// same resolved values get one shared host AND one shared program — all their
		// files are compiled together, matching v1's single-program approach which
		// avoids re-parsing lib/node_modules .d.ts files per project.
		const groups = Map.groupBy(projectData, ({ compilerOptions }) =>
			this.#host.hostKey(compilerOptions),
		);

		const requiredCompilerOptions =
			options.requiredCompilerOptions ?? REQUIRED_TYPE_EMITTER_OPTIONS;
		return [...groups.values()].map(
			(group) => new TypeEmissionProgram(group, this.#host, requiredCompilerOptions),
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
		if (evt.eventName === WatchEvents.add) {
			this.#programs?.forEach((p) => {
				p.addFile(file, project);
			});
		} else {
			this.invalidateReadFileCache(file.fullPath);
			this.#host.invalidateSourceFile(file.fullPath);
		}
		return this.transformProject(project, () => Promise.resolve([file]));
	}

	@invalidateCache(TsProgramHost.prototype.readFileFromDisk, {
		name: "FILE_CONTENT",
		keyFn: (...args) => args[0] as string,
	})
	private invalidateReadFileCache(_path: string): void {}
}
