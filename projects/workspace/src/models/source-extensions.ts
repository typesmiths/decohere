import path from "node:path";

/** TypeScript source extensions a workspace compiles. */
const SOURCE = [".ts", ".tsx", ".mts", ".cts"] as const;

/** The sources an import's extension can name: `./a.js` is `a.ts` or `a.tsx`, `./a.mjs` is `a.mts`. */
const SOURCES_FOR: Record<string, readonly string[]> = {
	".js": [".ts", ".tsx"],
	".jsx": [".tsx"],
	".mjs": [".mts"],
	".cjs": [".cts"],
	"": [".ts", ".tsx"],
};

/** Whether a path is a TypeScript source (not a declaration file). */
function isSource(file: string): boolean {
	return SOURCE.some((ext) => file.endsWith(ext)) && !/\.d\.[mc]?ts$/.test(file);
}

/**
 * The source files a path written in an import (or a built path) could name, most likely first:
 * itself when it is already a source, else the same stem with each matching source extension.
 */
function candidates(file: string): string[] {
	if (isSource(file)) return [file];
	const ext = path.extname(file);
	const known = SOURCES_FOR[ext];
	if (known == null) return [`${file}.ts`, `${file}.tsx`];
	const stem = ext === "" ? file : file.slice(0, -ext.length);
	return known.map((sourceExt) => `${stem}${sourceExt}`);
}

/** The extension a source builds to: `.mts` to `.mjs`, `.cts` to `.cjs`, the rest to `.js`. */
function outputExtension(file: string): string {
	if (file.endsWith(".mts")) return ".mjs";
	if (file.endsWith(".cts")) return ".cjs";
	return ".js";
}

/** The path a source builds to: `a.mts` to `a.mjs`, `a.cts` to `a.cjs`, `a.ts` and `a.tsx` to `a.js`. */
function outputPath(file: string): string {
	const ext = path.extname(file);
	const stem = ext === "" ? file : file.slice(0, -ext.length);
	return `${stem}${outputExtension(file)}`;
}

/** Whether a source is CommonJS (`.cts`); everything else compiles as an ES module. */
function isCommonJs(file: string): boolean {
	return file.endsWith(".cts");
}

export const sourceExtensions = {
	SOURCE,
	isSource,
	candidates,
	outputExtension,
	outputPath,
	isCommonJs,
};
