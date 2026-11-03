/** Default API project slug when `--name` is omitted. */
export const DEFAULT_WEBAPI_NAME = "api";

/** Relative path of an API project inside the monorepo. */
export function webapiProjectDir(name: string): string {
	return `projects/${name}`;
}

/**
 * Forge release entry for a scaffolded API (`pack: true` → per-target outDir).
 * Keep in sync with root `package.json` `"start"` / `"start:<name>"` and Dockerfiles.
 */
export function webapiReleaseEntry(name: string): string {
	return `dist/release/${webapiProjectDir(name)}/${webapiPackagedEntry()}`;
}

/** The same entry inside `.package/` (`forge package`), which is what the Dockerfile runs. */
export function webapiPackagedEntry(): string {
	return "es6/src/main.js";
}

/** npm package name for a scaffolded API (`flux serve --project`). */
export function webapiPackageName(workspaceName: string, apiName: string): string {
	return `@${workspaceName}/${apiName}`;
}

/** Local listen port for the nth API (0-based). Production uses `PORT`. */
export function webapiPort(index: number): number {
	return 3000 + index;
}

/** @deprecated Use `webapiProjectDir(name)`. Default path for the first API. */
export const WEBAPI_PROJECT_DIR = webapiProjectDir(DEFAULT_WEBAPI_NAME);

/** @deprecated Use `webapiReleaseEntry(name)`. Default start entry for the first API. */
export const WEBAPI_RELEASE_ENTRY = webapiReleaseEntry(DEFAULT_WEBAPI_NAME);
