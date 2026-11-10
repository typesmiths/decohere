import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { CREATE_VERSION, PACKAGE_DIR } from "../version.js";
import { merge } from "./merge.js";
import { type Names, templateNames } from "./names.js";
import type { WorkspaceChanges } from "./workspace-changes.js";

/**
 * The scaffolder's output is checked-in files under `templates/`, laid out as they land in a
 * workspace: `workspace/` (what every workspace starts with), `recipes/<name>/` (an app) and
 * `steps/<name>/` (what a `decohere add` step adds).
 */

/** The templates folder at the package's root, beside src/ in the repo. */
function dir(): string {
	return join(PACKAGE_DIR, "templates");
}

function recipesDir(): string {
	return join(dir(), "recipes");
}

/** Every file in a template folder, relative to it, with `/`. */
function listFiles(folder: string, sub = ""): string[] {
	const full = join(dir(), folder, sub);
	return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
		const path = sub === "" ? entry.name : `${sub}/${entry.name}`;
		return entry.isDirectory() ? listFiles(folder, path) : [path];
	});
}

/**
 * Where a template file lands: its placeholders filled in, and `_gitignore` and `_env` as
 * `.gitignore` and `.env`, which npm and git would otherwise drop from the package.
 */
function targetOf(path: string, names: Names): string {
	const filled = templateNames.substitute(path, names);
	const name = posix.basename(filled);
	return name.startsWith("_")
		? posix.join(posix.dirname(filled), `.${name.slice(1)}`)
		: filled;
}

/** A template file's text for one app: placeholders filled in, @decohere/* at this version. */
function contentOf(folder: string, path: string, names: Names): string {
	const text = templateNames.substitute(
		readFileSync(join(dir(), folder, path), "utf8"),
		names,
	);
	if (posix.basename(path) !== "package.json") return text;
	const manifest = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
	for (const key of ["dependencies", "devDependencies"]) {
		for (const name of Object.keys(manifest[key] ?? {})) {
			const deps = manifest[key];
			if (deps != null && name.startsWith("@decohere/")) deps[name] = CREATE_VERSION;
		}
	}
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

const MIGRATION = /^(.*\/src\/migrations)\/00000000-000000-(.+)\.ts$/;

export type ApplyOptions = {
	/** Template folders whose version of a file this one replaces, if the file is still theirs. */
	replaces?: readonly string[];
};

/**
 * Copies a template folder into the workspace for one app. A file the workspace doesn't have is
 * written; one it has is merged (manifests, config, ignore lists, README sections). A source file
 * it has is left alone, unless it is still exactly what a template in `replaces` wrote: then it is
 * replaced. Otherwise the user is told. A migration is written once, stamped with the time.
 */
function apply(
	changes: WorkspaceChanges,
	folder: string,
	names: Names,
	options: ApplyOptions = {},
): void {
	for (const path of listFiles(folder)) {
		let target = targetOf(path, names);
		let content = contentOf(folder, path, names);

		const migration = MIGRATION.exec(target);
		if (migration != null) {
			const [, migrationsDir, name] = migration;
			if (changes.listFiles(migrationsDir).some((file) => file.endsWith(`-${name}.ts`))) {
				continue;
			}
			const id = changes.stampMigration(name);
			target = `${migrationsDir}/${id}.ts`;
			content = content.replaceAll(`00000000-000000-${name}`, id);
		}

		const existing = changes.read(target);
		if (existing == null) {
			changes.write(target, content);
			continue;
		}
		const merged = merge.file(target, existing, content);
		if (merged != null) {
			if (merged !== existing) changes.write(target, merged);
			continue;
		}
		if ((options.replaces ?? []).some((from) => isStill(from, path, names, existing))) {
			changes.write(target, content);
			continue;
		}
		if (!isAnyTemplates(path, names, existing)) {
			changes.tellByHand(target, [
				"It has changed since it was generated, so it was left as it is. What this step adds is in",
				`  ${join(dir(), folder, path)}`,
			]);
		}
	}
}

/** True when `existing` is exactly what a template folder writes at that path. */
function isStill(folder: string, path: string, names: Names, existing: string): boolean {
	return existsSync(join(dir(), folder, path)) && contentOf(folder, path, names) === existing;
}

/** True when `existing` is what some template writes there: a later step's version, say. */
function isAnyTemplates(path: string, names: Names, existing: string): boolean {
	const folders = [
		"workspace",
		...["recipes", "steps"].flatMap((group) =>
			readdirSync(join(dir(), group)).map((name) => `${group}/${name}`),
		),
	];
	return folders.some((folder) => isStill(folder, path, names, existing));
}

export const templates = { apply, dir, recipesDir };
