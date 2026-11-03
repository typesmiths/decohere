import { existsSync } from "node:fs";
import path from "node:path";
import type { Project, Workspace } from "@decohere/workspace";
import { sourceExtensions, WorkspaceFactory } from "@decohere/workspace";
import { FileEx } from "@decohere/core/io";
import { ConsoleAdapter, scribe } from "@decohere/scribe";
import type { Options } from "@swc/core";
import { SwcTranspiler } from "../services/swc-transpiler.js";
import { BuildTargets } from "../types/build-target.type.js";
import { WorkspaceDefaults } from "../workspace.config.js";

// Above fatal (60) so all standard levels are nooped when logLevel is "silent"
const SILENT_LEVEL = 999;

const PLUGIN_NAME = "forge-vitest-source";

export type ForgeBuildOptions = {
	buildConfig?: string;
	logLevel?: string;
	workspaceRoot?: string;
};

export function forgeBuild(options?: ForgeBuildOptions) {
	const buildConfig = options?.buildConfig ?? "debug";
	const workspaceRoot = options?.workspaceRoot ?? process.cwd();
	const logLevel = options?.logLevel ?? "info";
	const loggerFactory = scribe.configure({
		adapter: new ConsoleAdapter(),
		options: { logLevel, customLevels: { silent: SILENT_LEVEL } },
	});
	const logger = loggerFactory(PLUGIN_NAME);

	const transpiler = new SwcTranspiler();
	/**
	 * SWC options per project (tsconfig, `.swcrc`, path aliases), built once: rebuilding them for
	 * every file was most of the plugin's per-file cost, as it was in flux.
	 */
	const baseConfigs = new Map<Project | undefined, Options>();
	const transformCache = new Map<
		string,
		{ content: string; result: { code: string; map: null } }
	>();

	let workspace: Workspace | null = null;

	const initWorkspace = async () => {
		if (workspace !== null) return;
		logger.debug(
			`Loading Forge workspace (buildConfig: ${buildConfig}, workspaceRoot: ${workspaceRoot})`,
		);
		workspace = await WorkspaceFactory.create({
			...WorkspaceDefaults,
			rootDir: workspaceRoot,
		});
	};

	const baseConfigFor = (project: Project | undefined): Options => {
		const cached = baseConfigs.get(project);
		if (cached != null) return cached;
		const config = transpiler.createBaseConfig(BuildTargets.es6, {
			aliasPaths: true,
			tsConfig: project?.getTsConfigSync(),
			userConfig: project?.getSwcConfigSync(),
			workspace: workspace ?? undefined,
		});
		baseConfigs.set(project, config);
		return config;
	};

	return {
		name: PLUGIN_NAME,
		enforce: "pre" as const,
		configResolved(): void {
			logger.debug("Plugin loaded");
		},
		resolveId(source: string, importer: string | undefined): string | null {
			// `./a.js` is `a.ts` or `a.tsx`, `./a.mjs` is `a.mts`, `./a.cjs` is `a.cts`.
			if (importer != null && /\.[mc]?jsx?$/.test(source) && source.startsWith(".")) {
				const written = path.resolve(path.dirname(importer), source);
				return sourceExtensions.candidates(written).find((c) => existsSync(c)) ?? null;
			}

			return null;
		},
		watchChange(id: string): void {
			transformCache.delete(id);
		},
		async transform(
			code: string,
			id: string,
		): Promise<{ code: string; map: string | null } | null> {
			if (id.includes("node_modules") || !/[.](ts|tsx|mts|cts)$/.test(id)) {
				return null;
			}

			const cached = transformCache.get(id);
			if (cached !== undefined && cached.content === code) {
				return cached.result;
			}

			await initWorkspace();
			const project = await workspace?.findProject(id, buildConfig);
			// The code Vite passes, not a read of the file: no content cache can serve an older
			// version, and there is no pre-warm compiling files ahead from disk.
			const response = await transpiler.transformCode(
				code,
				new FileEx({ fullPath: id, content: code }),
				BuildTargets.es6,
				baseConfigFor(project),
			);
			if (!response || response.outcome !== "success") return null;

			const result = { code: response.code, map: null };
			transformCache.set(id, { content: code, result });
			return result;
		},
	};
}
