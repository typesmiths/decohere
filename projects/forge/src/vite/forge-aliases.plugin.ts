import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageAliases, WORKSPACE_CONFIG, type Workspace } from "@decohere/workspace";
import { createWorkspace } from "../create-workspace.js";

export type ForgeAliasesOptions = {
	/**
	 * The workspace root. By default, the nearest folder above the Vite root that has a
	 * `.decohere.js`, else the nearest whose `projects/` folder holds the Vite root.
	 */
	workspaceRoot?: string | URL;
	/**
	 * Packages this project takes from `node_modules` (a published version) rather than from
	 * their source in the workspace.
	 */
	fromRegistry?: readonly string[];
};

/** The part of Vite's plugin API this plugin uses, so forge needn't depend on Vite. */
type ViteConfig = { root?: string };

/**
 * Resolves workspace packages by name to their source, as forge and flux do: `@app/ui/Button.astro`
 * is `projects/ui/src/Button.astro`. For a project Vite builds (Astro, a Vite app), in place of
 * pnpm workspaces or `link:` dependencies. Any file type resolves, not only TypeScript.
 *
 * ```js
 * // astro.config.mjs
 * import { forgeAliases } from "@decohere/forge/vite";
 * export default defineConfig({ vite: { plugins: [forgeAliases()] } });
 * ```
 */
export function forgeAliases(options: ForgeAliasesOptions = {}) {
	let root: string | undefined;
	let resolver: AliasResolver | undefined;
	const workspaceRootFor = (viteRoot: string) => {
		root ??= options.workspaceRoot
			? toPath(options.workspaceRoot)
			: findWorkspaceRoot(path.resolve(viteRoot));
		return root;
	};

	return {
		name: "decohere-forge-aliases",
		enforce: "pre" as const,
		config(config: ViteConfig) {
			// The dev server serves only files under its root, and the packages' sources are outside it.
			return { server: { fs: { allow: [workspaceRootFor(config.root ?? process.cwd())] } } };
		},
		async resolveId(source: string, importer: string | undefined): Promise<string | null> {
			resolver ??= aliasResolver(
				() => createWorkspace({ rootDir: workspaceRootFor(process.cwd()) }),
				options.fromRegistry,
			);
			return resolver(source, importer);
		},
	};
}

export type AliasResolver = (
	source: string,
	importer: string | undefined,
) => Promise<string | null>;

/**
 * A package-name import to the source file it names in the workspace, or `null` to leave it to the
 * next resolver: not a workspace package, imported from `node_modules`, or taken from the registry.
 */
export function aliasResolver(
	workspace: () => Promise<Workspace>,
	fromRegistry: readonly string[] = [],
): AliasResolver {
	let aliases: Promise<ReturnType<Workspace["getPackageAliases"]>> | undefined;
	const registry = new Set(fromRegistry);
	return async (source, importer) => {
		if (importer == null || /[\\/]node_modules[\\/]/.test(importer)) return null;
		const [specifier, query] = splitQuery(source);
		if (!packageAliases.isBareSpecifier(specifier)) return null;
		if (registry.has(packageNameOf(specifier))) return null;
		aliases ??= workspace().then((w) => w.getPackageAliases("debug"));
		const { paths, baseUrl } = await aliases;
		const file = packageAliases.resolvePath(specifier, paths, baseUrl);
		if (file == null || !existsSync(file)) return null;
		return file + query;
	};
}

/**
 * The workspace a Vite project is part of. Vite runs in the project's folder, and nothing in it
 * names the workspace, so look upward: a `.decohere.js`, else a folder whose `projects/` holds it.
 */
export function findWorkspaceRoot(from: string): string {
	for (let dir = from; ; dir = path.dirname(dir)) {
		if (existsSync(path.join(dir, WORKSPACE_CONFIG))) return dir;
		const projects = path.join(dir, "projects");
		if (
			existsSync(path.join(dir, "package.json")) &&
			isDirectory(projects) &&
			from.startsWith(projects + path.sep)
		) {
			return dir;
		}
		if (path.dirname(dir) === dir) break;
	}
	throw new Error(
		`forgeAliases: no Decohere workspace above ${from}. Expected a folder with ${WORKSPACE_CONFIG}, or one whose projects/ folder holds this project. Pass workspaceRoot to name it.`,
	);
}

function isDirectory(dir: string): boolean {
	return existsSync(dir) && statSync(dir).isDirectory();
}

function toPath(value: string | URL): string {
	return path.resolve(value instanceof URL ? fileURLToPath(value) : value);
}

/** `@app/ui/x.css?inline` → `@app/ui/x.css` and `?inline`: Vite's queries stay on the result. */
function splitQuery(source: string): [string, string] {
	const at = source.indexOf("?");
	return at === -1 ? [source, ""] : [source.slice(0, at), source.slice(at)];
}

/** `@app/ui/Button.astro` → `@app/ui`, `lodash/fp` → `lodash`. */
function packageNameOf(specifier: string): string {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}
