import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { CREATE_VERSION, PACKAGE_DIR } from "../version.js";
import { FileMerge } from "./file-merge.service.js";
import { type Names, TemplateNames } from "./template-names.value.js";
import type { WorkspaceChanges } from "./workspace-changes.model.js";

const MIGRATION = /^(.*\/src\/migrations)\/00000000-000000-(.+)\.ts$/;

export type ApplyOptions = {
	/** Template folders whose version of a file this one replaces, if the file is still theirs. */
	replaces?: readonly string[];
};

/**
 * The scaffolder's output is checked-in files under `templates/`, laid out as they land in a
 * workspace: `workspace/` (what every workspace starts with), `recipes/<name>/` (an app) and
 * `steps/<name>/` (what a `decohere add` step adds).
 */
export class Templates {
	readonly #merge = new FileMerge();

	/** @param dir The templates folder: by default the one at the package's root, beside src/. */
	public constructor(public readonly dir = join(PACKAGE_DIR, "templates")) {}

	public get recipesDir(): string {
		return join(this.dir, "recipes");
	}

	/**
	 * Copies a template folder into the workspace for one app. A file the workspace doesn't have
	 * is written; one it has is merged (manifests, config, ignore lists, README sections). A source
	 * file it has is left alone, unless it is still exactly what a template in `replaces` wrote:
	 * then it is replaced. Otherwise the user is told. A migration is written once, stamped with
	 * the time.
	 */
	public apply(
		changes: WorkspaceChanges,
		folder: string,
		names: Names,
		options: ApplyOptions = {},
	): void {
		const filler = new TemplateNames(names);
		for (const path of this.listFiles(folder)) {
			let target = this.targetOf(path, filler);
			let content = this.contentOf(folder, path, filler);

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
			const merged = this.#merge.merge(target, existing, content);
			if (merged != null) {
				if (merged !== existing) changes.write(target, merged);
				continue;
			}
			if (
				(options.replaces ?? []).some((from) => this.isStill(from, path, filler, existing))
			) {
				changes.write(target, content);
				continue;
			}
			if (!this.isAnyTemplates(path, filler, existing)) {
				changes.tellByHand(target, [
					"It has changed since it was generated, so it was left as it is. What this step adds is in",
					`  ${join(this.dir, folder, path)}`,
				]);
			}
		}
	}

	/** Every file in a template folder, relative to it, with `/`. */
	private listFiles(folder: string, sub = ""): string[] {
		const full = join(this.dir, folder, sub);
		return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
			const path = sub === "" ? entry.name : `${sub}/${entry.name}`;
			return entry.isDirectory() ? this.listFiles(folder, path) : [path];
		});
	}

	/**
	 * Where a template file lands: its placeholders filled in, and `_gitignore` and `_env` as
	 * `.gitignore` and `.env`, which npm and git would otherwise drop from the package.
	 */
	private targetOf(path: string, filler: TemplateNames): string {
		const filled = filler.fill(path);
		const name = posix.basename(filled);
		return name.startsWith("_")
			? posix.join(posix.dirname(filled), `.${name.slice(1)}`)
			: filled;
	}

	/** A template file's text for one app: placeholders filled in, @decohere/* at this version. */
	private contentOf(folder: string, path: string, filler: TemplateNames): string {
		const text = filler.fill(readFileSync(join(this.dir, folder, path), "utf8"));
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

	/** True when `existing` is exactly what a template folder writes at that path. */
	private isStill(
		folder: string,
		path: string,
		filler: TemplateNames,
		existing: string,
	): boolean {
		return (
			existsSync(join(this.dir, folder, path)) &&
			this.contentOf(folder, path, filler) === existing
		);
	}

	/** True when `existing` is what some template writes there: a later step's version, say. */
	private isAnyTemplates(path: string, filler: TemplateNames, existing: string): boolean {
		const folders = [
			"workspace",
			...["recipes", "steps"].flatMap((group) =>
				readdirSync(join(this.dir, group)).map((name) => `${group}/${name}`),
			),
		];
		return folders.some((folder) => this.isStill(folder, path, filler, existing));
	}
}
