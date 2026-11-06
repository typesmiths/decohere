import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

type ExportsTarget = string | null | { [key: string]: ExportsTarget };

type ReleaseManifest = {
	name?: string;
	main?: string;
	module?: string;
	types?: string;
	typings?: string;
	bin?: string | Record<string, string>;
	exports?: ExportsTarget;
};

/** Every file an `exports` value names. `null` means a subpath is blocked, so it names none. */
function exportsTargets(target: ExportsTarget | undefined): string[] {
	if (target == null) return [];
	if (typeof target === "string") return [target];
	return Object.values(target).flatMap(exportsTargets);
}

/** `./es6/x/*.js` is there if at least one file in `./es6/x/` fits it. */
function patternHasMatch(outDir: string, pattern: string): boolean {
	const relative = path.normalize(pattern);
	const [before, after] = relative.split("*") as [string, string];
	const folder = path.join(outDir, path.dirname(`${before}x`));
	if (!existsSync(folder)) return false;
	const prefix = path.basename(`${before}x`).slice(0, -1);
	return readdirSync(folder, { recursive: true, encoding: "utf8" }).some(
		(file) => file.startsWith(prefix) && file.endsWith(after),
	);
}

/**
 * The entry points that a release build's `package.json` names but the build doesn't contain.
 * Without this, a wrong path only shows up when someone imports it from the published package.
 */
export function missingEntryPoints(outDir: string): {
	name: string | undefined;
	missing: string[];
} {
	const manifestPath = path.join(outDir, "package.json");
	// npm reports a build that isn't there at all.
	if (!existsSync(manifestPath)) return { name: undefined, missing: [] };

	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReleaseManifest;
	const bin =
		typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
	const declared = [
		...exportsTargets(manifest.exports),
		...[manifest.main, manifest.module, manifest.types, manifest.typings].filter(
			(file): file is string => file != null,
		),
		...bin,
	];
	const missing = [...new Set(declared)].filter((file) =>
		file.includes("*") ? !patternHasMatch(outDir, file) : !existsSync(path.join(outDir, file)),
	);
	return { name: manifest.name, missing };
}
