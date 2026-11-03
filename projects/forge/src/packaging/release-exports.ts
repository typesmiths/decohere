import { type PackageExports, type PackageJson, sourceExtensions } from "@decohere/workspace";

/** Release `exports`: subpath (`.`, `./testing`) to a file path inside the release output. */
export type ReleaseExports = Record<string, string>;

const ES6_PREFIX = "./es6/";
/** Condition names that can point at runnable ESM, most specific first. `types` never does. */
const RUNTIME_CONDITIONS = ["import", "node", "default"];

/** `src/main.ts` becomes `src/main.js` (`.mts` `.mjs`, `.cts` `.cjs`), with any leading `./` dropped. */
function toJs(filePath: string): string {
	const file = filePath.replace(/^\.\//, "");
	return sourceExtensions.isSource(file) ? sourceExtensions.outputPath(file) : file;
}

/**
 * The `exports` a library needs once only its `es6/` output is shipped: the library's own
 * map (or its `main`) with every path pointed at `./es6/...js`.
 */
function build(pkg: PackageJson): ReleaseExports {
	const result: ReleaseExports = {};
	for (const [subpath, target] of Object.entries(subpathMap(pkg.exports))) {
		const file = runtimeFile(target);
		if (file != null) {
			result[subpath] = file.startsWith(ES6_PREFIX) ? file : `${ES6_PREFIX}${toJs(file)}`;
		}
	}

	if (Object.keys(result).length === 0) {
		result["."] = `${ES6_PREFIX}${toJs(pkg.main ?? "src/index.ts")}`;
	}
	return result;
}

/** The file one subpath (`""` for the package root, `/testing`) points at, or undefined. */
function resolve(exports: ReleaseExports, subpath: string): string | undefined {
	const key = subpath === "" ? "." : `.${subpath}`;
	const exact = exports[key];
	if (exact != null) {
		return exact;
	}

	for (const [pattern, target] of Object.entries(exports)) {
		const star = pattern.indexOf("*");
		if (star < 0) {
			continue;
		}
		const prefix = pattern.slice(0, star);
		const suffix = pattern.slice(star + 1);
		if (key.startsWith(prefix) && key.endsWith(suffix) && key.length >= pattern.length - 1) {
			return target.replaceAll("*", key.slice(prefix.length, key.length - suffix.length));
		}
	}
	return undefined;
}

/** A bare path or a conditions object means "the root"; otherwise keys are subpaths. */
function subpathMap(exports: PackageExports | undefined): Record<string, PackageExports> {
	if (exports == null) {
		return {};
	}
	if (typeof exports === "string") {
		return { ".": exports };
	}
	const keys = Object.keys(exports);
	return keys.length > 0 && keys.every((key) => key.startsWith("."))
		? exports
		: { ".": exports };
}

function runtimeFile(target: PackageExports | undefined): string | undefined {
	if (typeof target === "string") {
		return target;
	}
	if (target == null) {
		return undefined;
	}
	for (const condition of RUNTIME_CONDITIONS) {
		const file = runtimeFile(target[condition]);
		if (file != null) {
			return file;
		}
	}
	return undefined;
}

export const releaseExports = { build, resolve, toJs };
