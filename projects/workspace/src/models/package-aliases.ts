import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Project } from "./project.model.js";
import { sourceExtensions } from "./source-extensions.js";

export type PackageAliases = {
	/** Absolute base for SWC `jsc.paths` / specifier resolution. */
	baseUrl: string;
	/** Package-name and `name/*` keys, values relative to `baseUrl`. */
	paths: Record<string, string[]>;
};

/**
 * Convention aliases from workspace packages, then tsconfig `paths` for the same keys.
 * Prefer `Workspace.getPackageAliases` when a workspace is available.
 */
function build(
	projects: readonly Project[],
	options: { baseUrl: string; tsconfigPaths?: Record<string, string[]> },
): PackageAliases {
	const baseUrl = path.resolve(options.baseUrl);
	const paths = {
		...conventionAliasPaths(projects, baseUrl),
		...options.tsconfigPaths,
	};
	return { baseUrl, paths };
}

/** Bare import specifier that is not relative, absolute, or a node/file URL. */
function isBareSpecifier(specifier: string): boolean {
	return (
		specifier.length > 0 &&
		!specifier.startsWith(".") &&
		!specifier.startsWith("/") &&
		!specifier.startsWith("node:") &&
		!specifier.startsWith("file:") &&
		!specifier.startsWith("data:") &&
		!specifier.startsWith("#")
	);
}

/**
 * Resolve a bare specifier through package aliases (SWC-style `paths`
 * relative to `baseUrl`) to an absolute `.ts` path. Longest key wins.
 */
function resolvePath(
	specifier: string,
	paths: Record<string, string[]>,
	baseUrl: string,
): string | null {
	if (!isBareSpecifier(specifier)) return null;

	const resolvedBase = path.resolve(baseUrl);
	const keys = Object.keys(paths).sort((a, b) => b.length - a.length);

	for (const key of keys) {
		const target = paths[key]?.[0];
		if (target == null) continue;

		if (key.endsWith("/*")) {
			const prefix = key.slice(0, -1);
			if (!specifier.startsWith(prefix)) continue;
			const mappedRoot = target.endsWith("/*") ? target.slice(0, -2) : target;
			const subpath = specifier.slice(prefix.length);
			return subpathSource(path.resolve(resolvedBase, mappedRoot, subpath));
		}

		if (specifier === key) {
			return toTsSourcePath(path.resolve(resolvedBase, target.replace(/\*$/, "")));
		}
	}

	return null;
}

function conventionAliasPaths(
	projects: readonly Project[],
	baseUrl: string,
): Record<string, string[]> {
	const aliases: Record<string, string[]> = {};

	for (const project of projects) {
		const name = project.name;
		if (name.length === 0) continue;

		const entry = path.resolve(project.getSourceEntryPath());
		// A package with no root entry (only subpaths, like core) gets no bare alias, and its
		// subpaths resolve under `src/`.
		const hasEntry = existsSync(entry);
		if (hasEntry) aliases[name] = [toPosixRelative(baseUrl, entry)];
		const subpathRoot = hasEntry
			? path.dirname(entry)
			: path.resolve(project.rootDir, project.projectDirectory, "src");
		if (existsSync(subpathRoot)) {
			aliases[`${name}/*`] = [`${toPosixRelative(baseUrl, subpathRoot)}/*`];
		}
		// Subpaths the package exports, mapped to their sources: these can name any file,
		// not just `<sub>.ts` or `<sub>/index.ts` under the entry's directory.
		for (const [subpath, source] of Object.entries(project.getSourceExports())) {
			aliases[`${name}/${subpath.slice(2)}`] = [toPosixRelative(baseUrl, source)];
		}
	}

	return aliases;
}

function toPosixRelative(from: string, to: string): string {
	const relative = path.relative(from, to);
	if (relative === "") return ".";
	return relative.split(path.sep).join("/");
}

/**
 * The source file a wildcard subpath names: `<sub>` with a source extension (`.ts`, `.tsx`, or
 * `.mts`/`.cts` for `.mjs`/`.cjs`), else the `index` source of the directory it names (as
 * `@pkg/models` is `src/models/index.ts`), else the file as written when it is one (a UI
 * package's `Button.astro` or `theme.css`), else `<sub>.ts` for the caller to report missing.
 */
function subpathSource(candidate: string): string {
	const files = sourceExtensions.candidates(candidate);
	const directory = candidate.replace(/\.([mc]?[jt]sx?)$/, "");
	const indexes = sourceExtensions.candidates(path.join(directory, "index"));
	const found = [...files, ...indexes].find((file) => existsSync(file));
	if (found != null) return found;
	if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	return toTsSourcePath(candidate);
}

/** A target as a source path: itself when it is one, else its first source candidate. */
function toTsSourcePath(candidate: string): string {
	return sourceExtensions.candidates(candidate)[0] ?? `${candidate}.ts`;
}

export const packageAliases = { build, isBareSpecifier, resolvePath };
