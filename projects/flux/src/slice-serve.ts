/**
 * Directory-slice helpers for `flux serve <dir>…` — classify workspace packages as
 * Flux apps, Nixpacks-style script deferrals, or libraries to skip.
 */

export type SliceProjectView = {
	readonly name: string;
	/** Relative project dir from workspace root (e.g. `projects/funding/api`). */
	readonly projectDirectory: string;
	readonly main: string;
	readonly scripts: Record<string, string>;
};

export type SliceKind = "flux" | "defer" | "skip";

export type ClassifiedSlice = {
	readonly flux: SliceProjectView[];
	readonly defer: SliceProjectView[];
	readonly skip: SliceProjectView[];
};

/** Preferred package scripts for foreign toolchains (Nixpacks-style). */
export const DEFER_SCRIPT_CANDIDATES = ["dev", "serve"] as const;

/**
 * Normalize a CLI slice token to a `projects/…` prefix without a trailing slash.
 * `funding` and `projects/funding` both become `projects/funding`.
 */
export function normalizeSlicePrefix(slice: string): string {
	const trimmed = slice.replaceAll("\\", "/").replace(/\/+$/, "");
	if (trimmed === "" || trimmed === ".") {
		throw new Error("Slice directory must be a non-empty path");
	}
	if (trimmed === "projects" || trimmed.startsWith("projects/")) {
		return trimmed;
	}
	return `projects/${trimmed}`;
}

/**
 * True when `projectDirectory` belongs to the slice token.
 *
 * Matches:
 * - nested: `projects/funding`, `projects/funding/api`
 * - flat dotted package dirs: `projects/funding.web` for token `funding`
 *
 * Does not match siblings that only share a string prefix (`funding` vs `funding-fee.api`).
 */
export function isUnderSlice(projectDirectory: string, slicePrefix: string): boolean {
	const dir = projectDirectory.replaceAll("\\", "/").replace(/\/+$/, "");
	const prefix = slicePrefix.replaceAll("\\", "/").replace(/\/+$/, "");
	if (dir === prefix || dir.startsWith(`${prefix}/`)) {
		return true;
	}
	// Flat monorepo packages: projects/<module>.<role>
	return dir.startsWith(`${prefix}.`);
}

export function projectsInSlice(
	projects: readonly SliceProjectView[],
	slice: string,
): SliceProjectView[] {
	const prefix = normalizeSlicePrefix(slice);
	return projects.filter((p) => isUnderSlice(p.projectDirectory, prefix));
}

/** Union of packages under any of the slice tokens (deduped by package name). */
export function projectsInSlices(
	projects: readonly SliceProjectView[],
	slices: readonly string[],
): SliceProjectView[] {
	const byName = new Map<string, SliceProjectView>();
	for (const slice of slices) {
		for (const project of projectsInSlice(projects, slice)) {
			byName.set(project.name, project);
		}
	}
	return [...byName.values()];
}

/** Script invokes Flux (in-process serve stays on Flux, not deferred). */
export function isFluxOwnedScript(script: string): boolean {
	return /\bflux\b/i.test(script);
}

/**
 * First Nixpacks-style serve script that is not Flux-owned.
 * Prefers `dev`, then `serve`.
 */
export function resolveDeferScript(scripts: Record<string, string>): string | undefined {
	for (const name of DEFER_SCRIPT_CANDIDATES) {
		const body = scripts[name];
		if (body != null && body !== "" && !isFluxOwnedScript(body)) {
			return name;
		}
	}
	return undefined;
}

/** Convention: Flux Node apps use `main` ending in `main.ts` / `main.tsx`. */
export function isFluxAppMain(main: string): boolean {
	const normalized = main.replaceAll("\\", "/");
	return /(^|\/)main\.tsx?$/.test(normalized);
}

/**
 * Classify one package. Foreign serve scripts win over `main.ts` (Vite apps
 * often have a main entry but must not be HMR-booted by Flux).
 */
export function classifySliceProject(project: SliceProjectView): SliceKind {
	if (resolveDeferScript(project.scripts) != null) {
		return "defer";
	}
	if (isFluxAppMain(project.main)) {
		return "flux";
	}
	return "skip";
}

export function classifySliceProjects(
	projects: readonly SliceProjectView[],
	slices: string | readonly string[],
): ClassifiedSlice {
	const tokens = typeof slices === "string" ? [slices] : [...slices];
	const inSlice = projectsInSlices(projects, tokens);
	const flux: SliceProjectView[] = [];
	const defer: SliceProjectView[] = [];
	const skip: SliceProjectView[] = [];
	for (const project of inSlice) {
		const kind = classifySliceProject(project);
		if (kind === "flux") flux.push(project);
		else if (kind === "defer") defer.push(project);
		else skip.push(project);
	}
	return { flux, defer, skip };
}
