import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageAliases, sourceExtensions } from "@decohere/workspace";

export type RewriteServeSpecifierOptions = {
	specifier: string;
	parentUrl: string;
	isWatchedTs: (absolutePath: string) => boolean;
	resolveBare: (specifier: string) => string | null;
	versionFileUrl: (fileUrl: string) => string;
};

/**
 * Map a resolve-hook specifier to a versioned watched `.ts` file URL.
 * Covers relative `.js` / `.ts` / extensionless imports, directory imports (`./models` is
 * `./models/index.ts`), and bare workspace package names and subpaths. Flux compiles without
 * SWC's own path resolution, so this is the only place imports are mapped to sources.
 */
export function rewriteServeSpecifier(options: RewriteServeSpecifierOptions): string | null {
	const { specifier, parentUrl, isWatchedTs, resolveBare, versionFileUrl } = options;

	const relativeTs = resolveRelativeWatchedTs(specifier, parentUrl, isWatchedTs);
	if (relativeTs != null) {
		return versionFileUrl(pathToFileURL(relativeTs).toString());
	}

	const bareTarget = resolveBare(specifier);
	const bareTs = bareTarget == null ? null : watchedTs(bareTarget, isWatchedTs);
	if (bareTs != null) {
		return versionFileUrl(pathToFileURL(bareTs).toString());
	}

	return null;
}

/**
 * The watched source file a path names: itself, or the source its extension stands for (`.js` is
 * `.ts` or `.tsx`, `.mjs` is `.mts`, `.cjs` is `.cts`, none adds `.ts` or `.tsx`), else the
 * `index` source of the directory it names. A file wins over a directory of the same name.
 */
function watchedTs(filePath: string, isWatchedTs: (absolutePath: string) => boolean) {
	const withoutSlash = filePath.replace(/[/\\]+$/, "");
	// The workspace alias lookup may have added `.ts` to a subpath that names a directory (`@lib/models`
	// arrives as `…/models.ts`), so the directory is the path without any extension.
	const directory = withoutSlash.replace(/\.([mc]?[jt]sx?)$/, "");
	const candidates = [
		...sourceExtensions.candidates(withoutSlash),
		...sourceExtensions.candidates(directory),
		...sourceExtensions.candidates(path.join(directory, "index")),
	];
	return candidates.find((candidate) => isWatchedTs(candidate)) ?? null;
}

function resolveRelativeWatchedTs(
	specifier: string,
	parentUrl: string,
	isWatchedTs: (absolutePath: string) => boolean,
): string | null {
	if (packageAliases.isBareSpecifier(specifier)) return null;
	if (!(specifier.startsWith(".") || specifier.startsWith("/"))) return null;

	const parentClean = parentUrl.split("?")[0];
	if (parentClean == null || parentClean === "") return null;

	let resolved: URL;
	try {
		resolved = new URL(specifier, parentClean);
	} catch {
		return null;
	}
	if (resolved.protocol !== "file:") return null;

	return watchedTs(fileURLToPath(resolved), isWatchedTs);
}
