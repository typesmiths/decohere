import fs from "node:fs";
import path from "node:path";
import { io } from "@decohere/core/io";
import { parseTsconfig, type TsConfigJson } from "get-tsconfig";
import { WorkspaceConfigurationError } from "../errors.js";
import { parseJsonc } from "./jsonc.js";

/** `compilerOptions` as written in `tsconfig.json`, after `extends`; `baseUrl` is absolute. */
export type CompilerOptions = TsConfigJson.CompilerOptions;

export const DEFAULT_COMPILER_OPTIONS: CompilerOptions = {
	emitDeclarationOnly: true,
	declaration: true,
	baseUrl: "./",
};

/**
 * A `tsconfig.json`, read without the TypeScript compiler so running a file doesn't load it.
 * Code that needs the compiler's own parse (type emission) parses `filePath` itself.
 */
export class Tsconfig {
	public static default() {
		return new Tsconfig();
	}

	public static async parse(filePath: string) {
		if (!(await io.fileExists(filePath))) {
			throw new WorkspaceConfigurationError(`TSConfig not found ${filePath}`);
		}
		return Tsconfig.read(filePath);
	}

	public static parseSync(filePath: string) {
		if (!Tsconfig.fileExistsSync(filePath)) {
			throw new WorkspaceConfigurationError(`TSConfig not found ${filePath}`);
		}
		return Tsconfig.read(filePath);
	}

	private static read(filePath: string): Tsconfig {
		const fullPath = path.resolve(filePath);
		let compilerOptions: CompilerOptions;
		try {
			// get-tsconfig reads broken JSON as `{}`; check the file itself first.
			parseJsonc(fs.readFileSync(fullPath, "utf8"));
			compilerOptions = parseTsconfig(fullPath).compilerOptions ?? {};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new WorkspaceConfigurationError(`Error parsing ${filePath}. ${message}`, {
				cause: error,
			});
		}
		const { baseUrl } = compilerOptions;
		return new Tsconfig({
			filePath: fullPath,
			compilerOptions:
				baseUrl == null
					? compilerOptions
					: { ...compilerOptions, baseUrl: path.resolve(path.dirname(fullPath), baseUrl) },
		});
	}

	private static fileExistsSync(filePath: string): boolean {
		try {
			return fs.statSync(filePath).isFile();
		} catch {
			return false;
		}
	}

	public constructor(data: Partial<Tsconfig> = { compilerOptions: DEFAULT_COMPILER_OPTIONS }) {
		Object.assign(this, data);
	}

	/** Absolute path of the file read; undefined for {@link Tsconfig.default}. */
	public readonly filePath?: string;
	public readonly compilerOptions: CompilerOptions;
}
