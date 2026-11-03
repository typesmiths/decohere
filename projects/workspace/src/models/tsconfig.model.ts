import fs from "node:fs";
import path from "node:path";
import { io } from "@decohere/core/io";
import ts, { type CompilerOptions } from "typescript";
import { WorkspaceConfigurationError } from "../errors.js";

const host = ts.sys;

host.readFile = (file) => {
	return fs.readFileSync(file, { encoding: "utf8" }) as string;
};

host.readDirectory = (directoryName) => {
	return fs
		.readdirSync(directoryName, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
};

export const DEFAULT_COMPILER_OPTIONS: CompilerOptions = {
	emitDeclarationOnly: true,
	declaration: true,
	baseUrl: "./",
};

export class Tsconfig {
	public static default() {
		return new Tsconfig();
	}

	public static async parse(filePath: string) {
		if (!(await io.fileExists(filePath))) {
			throw new WorkspaceConfigurationError(`TSConfig not found ${filePath}`);
		}
		const configFileText = await io.readFile(filePath);
		const result = ts.parseConfigFileTextToJson(filePath, configFileText);
		if (result.error) {
			const errorMessage = result.error.messageText.toString();
			throw new WorkspaceConfigurationError(`Error parsing ${filePath}. ${errorMessage}`);
		}
		const dirName = path.resolve(path.dirname(filePath));
		const configParseResult = ts.parseJsonConfigFileContent(result.config, host, dirName);
		return new Tsconfig({
			compilerOptions: configParseResult.options,
			errors: configParseResult.errors,
		});
	}

	public static parseSync(filePath: string) {
		if (!Tsconfig.fileExistsSync(filePath)) {
			throw new WorkspaceConfigurationError(`TSConfig not found ${filePath}`);
		}
		const configFileText = fs.readFileSync(filePath, "utf8");
		const result = ts.parseConfigFileTextToJson(filePath, configFileText);
		if (result.error) {
			const errorMessage = result.error.messageText.toString();
			throw new WorkspaceConfigurationError(`Error parsing ${filePath}. ${errorMessage}`);
		}
		const dirName = path.resolve(path.dirname(filePath));
		const configParseResult = ts.parseJsonConfigFileContent(result.config, host, dirName);
		return new Tsconfig({
			compilerOptions: configParseResult.options,
			errors: configParseResult.errors,
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

	public readonly compilerOptions: CompilerOptions;
	public readonly errors: readonly ts.Diagnostic[];
}
