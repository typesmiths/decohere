import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_WEBAPI_NAME } from "./const.js";

/** Lowercase npm-safe directory slug: `billing`, `admin-api`. */
export const API_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export class CreateCliError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "CreateCliError";
	}
}

export function assertValidApiName(name: string): void {
	if (!API_NAME_PATTERN.test(name)) {
		throw new CreateCliError(
			`Invalid API name "${name}". Use a lowercase slug starting with a letter, then letters, digits, or hyphens (e.g. billing).`,
		);
	}
}

/** Default `["api"]` when the caller omitted `--name`. Rejects duplicates and invalid slugs. */
export function parseApiNames(raw: readonly string[] | undefined): string[] {
	const names = raw != null && raw.length > 0 ? [...raw] : [DEFAULT_WEBAPI_NAME];
	const seen = new Set<string>();
	for (const name of names) {
		assertValidApiName(name);
		if (seen.has(name)) {
			throw new CreateCliError(`Duplicate API name "${name}".`);
		}
		seen.add(name);
	}
	return names;
}

export function isDecohereWorkspace(dir: string): boolean {
	try {
		const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
			scripts?: Record<string, string>;
		};
		const build = pkg.scripts?.build;
		return typeof build === "string" && build.includes("forge");
	} catch {
		return false;
	}
}

/** Directory names under `projects/` that already have a `package.json`. */
export function listExistingApiNames(dir: string): string[] {
	const projectsDir = join(dir, "projects");
	try {
		return readdirSync(projectsDir, { withFileTypes: true })
			.filter(
				(entry) =>
					entry.isDirectory() && existsSync(join(projectsDir, entry.name, "package.json")),
			)
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

/** `billing` → `BILLING`, `admin-api` → `ADMIN_API` — prefix for `{PREFIX}_DB_HOST`. */
export function apiEnvPrefix(apiName: string): string {
	return apiName.replace(/-/g, "_").toUpperCase();
}

export function apiNameFromProjectDir(dir: string): string {
	const slash = dir.lastIndexOf("/");
	return slash >= 0 ? dir.slice(slash + 1) : dir;
}
