import path from "node:path";
import type { Project, Tsconfig } from "@decohere/workspace";
import { Trace } from "@decohere/devkit/diagnostics";
import type { FileEx } from "@decohere/core/io";
import ts from "typescript";
import type { TsProgramHost } from "../services/ts-program-host.js";
import { TransformResponse } from "../types/transform-response.model.js";

export type TypeProgramProject = {
	project: Project;
	files: FileEx[];
	tsconfig: Tsconfig;
	/** The compiler's parse of `tsconfig`. */
	compilerOptions: ts.CompilerOptions;
	/** Files the project's own tsconfig lists, checked beside its sources (`forge typecheck`). */
	tsconfigFiles?: readonly string[];
};

type EmissionTarget = {
	file: FileEx;
	tsconfig: Tsconfig;
	project: Project;
	outputPath: string;
	outputDir: string;
	dtsRelative: string;
};

@Trace
export class TypeEmissionProgram {
	#program: ts.Program;
	#group: TypeProgramProject[];
	#targetsByDtsPath: Map<string, EmissionTarget>;
	#targetsByEmittedPath: Map<string, EmissionTarget>;
	#host: TsProgramHost;
	#compilerHost: ts.CompilerHost;
	#allFiles: FileEx[];
	#compilerOptions: ts.CompilerOptions;
	#requiredOptions: ts.CompilerOptions;

	public constructor(
		group: TypeProgramProject[],
		hostFactory: TsProgramHost,
		requiredOptions: ts.CompilerOptions,
	) {
		this.#group = group;
		const targets = this.buildTargetMaps(group);
		this.#targetsByDtsPath = targets.byDtsPath;
		this.#targetsByEmittedPath = targets.byEmittedPath;
		this.#host = hostFactory;
		this.#compilerOptions = group[0].compilerOptions;
		this.#requiredOptions = requiredOptions;
		this.#allFiles = group.flatMap(({ files }) => files);
		this.#compilerHost = hostFactory.createHost(this.#compilerOptions);
		this.#program = this.createProgram();
	}

	public check(): readonly ts.Diagnostic[] {
		this.refreshProgramIfNeeded();
		return ts.getPreEmitDiagnostics(this.#program);
	}

	public formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
		return ts.formatDiagnosticsWithColorAndContext(diagnostics, this.#compilerHost);
	}

	private toEmissionTarget(
		groupProject: TypeProgramProject,
		file: FileEx,
		outBaseDir: string,
	): EmissionTarget {
		const extName = path.extname(file.relativePath);
		const dtsRelative = file.relativePath.replace(new RegExp(`${extName}$`), ".d.ts");
		const outputPath = path.join(outBaseDir, dtsRelative);
		return {
			file,
			tsconfig: groupProject.tsconfig,
			project: groupProject.project,
			outputPath,
			outputDir: path.dirname(outputPath),
			dtsRelative,
		};
	}

	private emittedKey(file: FileEx): string {
		return file.fullPath.replace(/\.[^.]+$/, ".d.ts");
	}

	private buildTargetMaps(group: TypeProgramProject[]): {
		byDtsPath: Map<string, EmissionTarget>;
		byEmittedPath: Map<string, EmissionTarget>;
	} {
		const byDtsPath = new Map<string, EmissionTarget>();
		const byEmittedPath = new Map<string, EmissionTarget>();

		for (const groupProject of group) {
			const outBaseDir = groupProject.project.getOutDir("types");
			for (const file of groupProject.files) {
				const target = this.toEmissionTarget(groupProject, file, outBaseDir);
				byDtsPath.set(target.dtsRelative, target);
				byEmittedPath.set(this.emittedKey(file), target);
			}
		}

		return { byDtsPath, byEmittedPath };
	}

	public addFile(file: FileEx, project: Project): void {
		const groupProject = this.#group.find((g) => g.project === project);
		if (groupProject == null) return;

		groupProject.files.push(file);
		this.#allFiles.push(file);

		const outBaseDir = groupProject.project.getOutDir("types");
		const target = this.toEmissionTarget(groupProject, file, outBaseDir);
		this.#targetsByDtsPath.set(target.dtsRelative, target);
		this.#targetsByEmittedPath.set(this.emittedKey(file), target);
		this.#host.invalidateSourceFile(file.fullPath);
	}

	public async emit(
		fileFilter?: (project: Project) => Promise<FileEx[]>,
		onOutput?: (response: TransformResponse) => void,
	): Promise<TransformResponse[]> {
		this.refreshProgramIfNeeded();
		if (fileFilter == null) {
			return this.emitAll(onOutput);
		}
		return this.emitFiltered(fileFilter, onOutput);
	}

	private createProgram(oldProgram?: ts.Program): ts.Program {
		return this.#host.createProgram(
			this.#allFiles,
			this.#compilerOptions,
			this.#compilerHost,
			oldProgram,
			this.#requiredOptions,
			this.#group.flatMap(({ tsconfigFiles }) => tsconfigFiles ?? []),
		);
	}

	private refreshProgramIfNeeded(): void {
		if (this.#host.hasInvalidated()) {
			this.#program = this.createProgram(this.#program);
		}
	}

	private emitAll(onOutput?: (response: TransformResponse) => void): TransformResponse[] {
		const responses: TransformResponse[] = [];
		this.#program.emit(undefined, (emittedPath, content) => {
			if (!emittedPath.endsWith(".d.ts")) {
				return;
			}
			const response = this.toTransformResponse(emittedPath, content);
			responses.push(response);
			onOutput?.(response);
		});
		return responses;
	}

	private async emitFiltered(
		fileFilter: (project: Project) => Promise<FileEx[]>,
		onOutput?: (response: TransformResponse) => void,
	): Promise<TransformResponse[]> {
		const files = await Promise.all(this.#group.map(({ project }) => fileFilter(project)));
		const sourceFiles = files
			.flat()
			.map((file) => this.#program.getSourceFile(file.fullPath))
			.filter((sf): sf is ts.SourceFile => sf != null);

		const responses: TransformResponse[] = [];

		for (const sourceFile of sourceFiles) {
			this.#program.emit(sourceFile, (emittedPath, content) => {
				if (!emittedPath.endsWith(".d.ts")) {
					return;
				}
				const response = this.toTransformResponse(emittedPath, content);
				responses.push(response);
				onOutput?.(response);
			});
		}

		return responses;
	}

	private toTransformResponse(emittedPath: string, content: string): TransformResponse {
		const target = this.#targetsByEmittedPath.get(emittedPath);
		if (target == null) {
			throw new Error(`No matching emission target for: ${emittedPath}`);
		}
		return this.toTransformResponseFromTarget(target, content);
	}

	private toTransformResponseFromTarget(
		target: EmissionTarget,
		content: string,
	): TransformResponse {
		const { file, tsconfig, project, outputPath, outputDir, dtsRelative } = target;
		return TransformResponse.from({
			file,
			config: tsconfig,
			outcome: "success",
			fileName: dtsRelative,
			code: content,
			target: "types",
			messages: [],
			project,
			outputDir,
			outputPath,
		});
	}
}
