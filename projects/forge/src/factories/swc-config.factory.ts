import path from "node:path";
import { packageAliases, type Tsconfig } from "@decohere/workspace";
import { Trace } from "@decohere/devkit/diagnostics";
import type { FileEx } from "@decohere/core/io";
import { merge } from "@decohere/core/objects";
import type { Options } from "@swc/core";
import { ForgeError } from "../errors.js";
import type { TranspileTarget } from "../types/build-target.type.js";
import type { SwcConfigOptions } from "../types/swc-config.type.js";

const defaultOptions = {
	jsc: {
		parser: {
			syntax: "typescript",
			decorators: true,
		},
		target: "esnext",
		transform: {
			decoratorMetadata: true,
		},
		experimental: { keepImportAttributes: true },
	},
	module: {
		resolveFully: true,
	},
	sourceMaps: "inline",
};

@Trace
export class SwcConfigFactory {
	/**
	 * Creates a base config for a project+target combination, without a filename.
	 * Call once per (project, target) and then use createFileConfig() per file.
	 */
	public createBaseConfig(
		buildTarget: TranspileTarget,
		configOptions: SwcConfigOptions,
	): Options {
		const { userConfig, tsConfig, aliasPaths, sourceMaps, workspace, projects } =
			configOptions;
		const { compilerOptions } = tsConfig ?? {};
		const aliases = aliasPaths
			? workspace != null
				? workspace.getPackageAliases(projects?.[0]?.configuration.name ?? "debug")
				: projects != null && projects.length > 0
					? packageAliases.build(projects, {
							baseUrl:
								SwcConfigFactory.getBaseUrl(tsConfig) ?? path.resolve(projects[0].rootDir),
							tsconfigPaths: compilerOptions?.paths as Record<string, string[]> | undefined,
						})
					: undefined
			: undefined;
		const tsconfigOnlyPaths =
			aliasPaths && aliases == null
				? (compilerOptions?.paths as Record<string, string[]> | undefined)
				: undefined;
		const paths = SwcConfigFactory.nonemptyPaths(aliases?.paths ?? tsconfigOnlyPaths);
		const baseUrl =
			aliases?.baseUrl ??
			SwcConfigFactory.getBaseUrl(tsConfig) ??
			(workspace != null ? path.resolve(workspace.rootDir) : undefined) ??
			(paths != null ? path.resolve(".") : undefined);

		const options: Options = {
			jsc: {
				baseUrl,
				paths,
			},
			module: {
				type: buildTarget,
			},
			...(sourceMaps === false ? { sourceMaps: false } : {}),
		};

		return merge.withOptions<Options>(
			{ mergeArrays: false },
			defaultOptions,
			options,
			userConfig ?? {},
		);
	}

	/** Stamps a per-file filename onto a pre-built base config; `.tsx` also turns on JSX. */
	public createFileConfig(file: FileEx, baseConfig: Options): Options {
		const tsx = file.fullPath.endsWith(".tsx");
		const jsc =
			tsx && baseConfig.jsc?.parser?.syntax === "typescript"
				? { ...baseConfig.jsc, parser: { ...baseConfig.jsc.parser, tsx: true } }
				: baseConfig.jsc;
		const config = { ...baseConfig, jsc, filename: file.fullPath };
		this.validate(config);
		return config;
	}

	private static nonemptyPaths(
		paths: Record<string, string[]> | undefined,
	): Record<string, string[]> | undefined {
		if (paths == null || Object.keys(paths).length === 0) return undefined;
		return paths;
	}

	/**
	 * Validates SWC options against known causes of Rust/NAPI process crashes.
	 * Throws a ForgeError with a descriptive message instead of letting the
	 * NAPI layer abort the process.
	 *
	 * Known crash causes:
	 * - `jsc.baseUrl` set to a relative path (SWC requires an absolute path)
	 */
	public validate(options: Options): void {
		const baseUrl = options.jsc?.baseUrl;
		if (baseUrl != null && !path.isAbsolute(baseUrl)) {
			throw new ForgeError(
				`SWC config: jsc.baseUrl must be an absolute path to avoid a process crash, got: "${baseUrl}". Use path.resolve() to convert it.`,
			);
		}
	}

	/** Resolves tsconfig baseUrl to an absolute path. Returns undefined if not set. */
	private static getBaseUrl(tsConfig: Tsconfig | undefined): string | undefined {
		const baseUrl = tsConfig?.compilerOptions?.baseUrl;
		if (baseUrl == null) return undefined;
		return path.resolve(baseUrl);
	}
}
