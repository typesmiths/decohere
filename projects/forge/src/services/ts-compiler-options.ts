import fs from "node:fs";
import path from "node:path";
import type { Tsconfig } from "@decohere/workspace";
import ts from "typescript";
import { ForgeError } from "../errors.js";

const host: ts.ParseConfigHost = {
	...ts.sys,
	readFile: (file) => fs.readFileSync(file, { encoding: "utf8" }),
	readDirectory: (directoryName) =>
		fs
			.readdirSync(directoryName, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name),
};

/**
 * No tsconfig means no choices made, so this reads the project as plain tsc would: it clears
 * the `lib` and `types` limits forge sets to keep monorepos fast, which a project opts out of
 * in its tsconfig. Decorators are on because forge and flux compile them by default.
 */
const DEFAULT_TS_OPTIONS: ts.CompilerOptions = {
	emitDeclarationOnly: true,
	declaration: true,
	lib: undefined,
	types: undefined,
	experimentalDecorators: true,
};

/**
 * A project's compiler options as the TypeScript compiler parses its `tsconfig.json`: what
 * type emission needs (enums, every option, tsc's own defaults). The workspace reads only
 * what transpiling needs, without loading the compiler.
 */
export function tsCompilerOptions(tsconfig: Tsconfig): ts.CompilerOptions {
	const { filePath } = tsconfig;
	if (filePath == null) return { ...DEFAULT_TS_OPTIONS };
	const result = ts.parseConfigFileTextToJson(filePath, fs.readFileSync(filePath, "utf8"));
	if (result.error) {
		throw new ForgeError(
			`Error parsing ${filePath}. ${ts.flattenDiagnosticMessageText(result.error.messageText, "\n")}`,
		);
	}
	return ts.parseJsonConfigFileContent(result.config, host, path.dirname(filePath)).options;
}

/**
 * The files a tsconfig lists through `include` and `files`, as `tsc -p` reads them: a project's
 * own tsconfig can list generated declaration files (a framework's `types.d.ts`) its code needs.
 * Read like `tsCompilerOptions` (through `node:fs`), with TypeScript's own walk for the globs.
 */
export function getTsconfigFileNames(filePath: string): string[] {
	const result = ts.parseConfigFileTextToJson(filePath, fs.readFileSync(filePath, "utf8"));
	if (result.error) {
		throw new ForgeError(
			`Error parsing ${filePath}. ${ts.flattenDiagnosticMessageText(result.error.messageText, "\n")}`,
		);
	}
	const filesHost: ts.ParseConfigHost = { ...host, readDirectory: ts.sys.readDirectory };
	return ts.parseJsonConfigFileContent(result.config, filesHost, path.dirname(filePath))
		.fileNames;
}
