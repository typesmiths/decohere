import fs from "node:fs";
import { cache } from "@decohere/core/caching";
import { Trace } from "@decohere/devkit/diagnostics";
import type { FileEx } from "@decohere/core/io";
import type ts from "typescript";
import { createCompilerHost, createProgram } from "typescript";
import {
	DEFAULT_TYPE_EMITTER_OPTIONS,
	REQUIRED_TYPE_EMITTER_OPTIONS,
} from "../services/type-emitter.js";

/**
 * Wraps a TypeScript CompilerHost with cached file-system calls so that
 * repeated reads during a single build do not hit the disk multiple times.
 *
 * Separating this from TypeEmitter keeps the transformer logic readable and
 * lets the caching/program-creation concerns live in one focused place.
 */
@Trace
export class TsProgramHost {
	#invalidated = new Set<string>();

	public invalidateSourceFile(fileName: string): void {
		this.#invalidated.add(fileName);
	}

	public hasInvalidated(): boolean {
		return this.#invalidated.size > 0;
	}

	/** Returns a stable string key for a set of compiler options that affect host behaviour. */
	public hostKey(opts: ts.CompilerOptions): string {
		return JSON.stringify({
			target: opts.target,
			lib: opts.lib,
			typeRoots: opts.typeRoots,
			types: opts.types,
			moduleResolution: opts.moduleResolution,
			baseUrl: opts.baseUrl,
			paths: opts.paths,
			module: opts.module,
			rootDir: opts.rootDir,
			rootDirs: opts.rootDirs,
		});
	}

	public createHost(compilerOptions: ts.CompilerOptions): ts.CompilerHost {
		const host = createCompilerHost(compilerOptions);
		host.fileExists = (fileName) => this.fileExistsOnDisk(fileName);
		host.readFile = (fileName) => this.readFileFromDisk(fileName);
		host.directoryExists = (directoryName) => this.directoryExists(directoryName);
		host.getDirectories = (directoryName) => this.getDirectories(directoryName);
		return host;
	}

	public createProgram(
		files: FileEx[],
		compilerOptions: ts.CompilerOptions,
		host: ts.CompilerHost,
		oldProgram?: ts.Program,
		requiredOptions: ts.CompilerOptions = REQUIRED_TYPE_EMITTER_OPTIONS,
		extraRootNames: readonly string[] = [],
	): ts.Program {
		const filePaths = [...new Set([...files.map((f) => f.fullPath), ...extraRootNames])];
		this.#invalidated.clear();
		return createProgram(
			filePaths,
			{
				...DEFAULT_TYPE_EMITTER_OPTIONS,
				...compilerOptions,
				...requiredOptions,
			},
			host,
			oldProgram,
		);
	}

	@cache({ name: "FILE_CONTENT", keyFn: (...args) => args[0] as string })
	public readFileFromDisk(fileName: string): string | undefined {
		try {
			return fs.readFileSync(fileName, "utf8");
		} catch {
			return undefined;
		}
	}

	@cache()
	public fileExistsOnDisk(fileName: string): boolean {
		return fs.existsSync(fileName);
	}

	@cache()
	public directoryExists(directoryName: string): boolean {
		try {
			return fs.statSync(directoryName).isDirectory();
		} catch {
			return false;
		}
	}

	@cache()
	public getDirectories(directoryName: string): string[] {
		try {
			return fs
				.readdirSync(directoryName, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name);
		} catch {
			return [];
		}
	}
}
