import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { KeyedModel, SourceFile, SourceFileProvider } from "./source-file.js";

/**
 * A sub-unit of the monorepo (e.g. `projects/api`).
 *
 * Models and files registered here produce paths relative to `dir`. The parent
 * `MonoRepoScaffold` calls `files()` and prepends `dir/` to every path, so
 * models remain unaware of where they live in the repo.
 */
export class ProjectScaffold {
	private readonly _models = new Map<string, SourceFileProvider>();
	private readonly _files: SourceFile[] = [];

	public constructor(public readonly dir: string) {}

	public addModel<T extends KeyedModel>(model: T): T {
		this._models.set(model.key, model);
		return model;
	}

	public addFile(provider: SourceFileProvider): this {
		this._files.push(...provider.files());
		return this;
	}

	public getModel<T extends SourceFileProvider>(key: string): T | undefined {
		return this._models.get(key) as T | undefined;
	}

	public getModels<T extends SourceFileProvider>(ctor: new (...args: never[]) => T): T[] {
		return [...this._models.values()].filter((m): m is T => m instanceof ctor);
	}

	/** Returns all files with `dir/` prepended to each path. */
	public files(): SourceFile[] {
		const all = [...this._files, ...[...this._models.values()].flatMap((m) => m.files())];
		return all.map((f) => ({ filePath: `${this.dir}/${f.filePath}`, content: f.content }));
	}
}

export abstract class WorkspaceScaffold {
	public readonly files: SourceFile[] = [];
	public targetDir: string = process.cwd();
	private _name: string | undefined;

	/** Project name — host directory basename, not the in-container mount path. */
	public get name(): string {
		return this._name ?? basename(this.targetDir);
	}

	public setName(name: string): this {
		this._name = name;
		return this;
	}

	/** Add an ad-hoc file provider whose output is included at render time. */
	public addFile(provider: SourceFileProvider): this {
		this.files.push(...provider.files());
		return this;
	}

	public abstract addModel<T extends KeyedModel>(model: T): T;
	public abstract getModel<T extends SourceFileProvider>(key: string): T | undefined;
	public abstract getModels<T extends SourceFileProvider>(
		ctor: new (...args: never[]) => T,
	): T[];
	public abstract getProject(dir: string): ProjectScaffold | undefined;
	public abstract getProjects(): readonly ProjectScaffold[];
	public abstract scaffold(): Promise<void> | void;
}

export class MonoRepoScaffold extends WorkspaceScaffold {
	private readonly _models = new Map<string, SourceFileProvider>();
	private readonly _projects: ProjectScaffold[] = [];

	/** Register a named project. */
	public addProject(project: ProjectScaffold): ProjectScaffold {
		this._projects.push(project);
		return project;
	}

	/** Retrieve a previously-registered project by its directory path. */
	public getProject(dir: string): ProjectScaffold | undefined {
		return this._projects.find((p) => p.dir === dir);
	}

	/** All registered projects, in registration order. */
	public getProjects(): readonly ProjectScaffold[] {
		return this._projects;
	}

	/** Register a named model at workspace level. */
	public addModel<T extends KeyedModel>(model: T): T {
		this._models.set(model.key, model);
		return model;
	}

	/**
	 * Retrieve a model by key. Searches workspace models first, then all
	 * registered projects in order.
	 */
	public getModel<T extends SourceFileProvider>(key: string): T | undefined {
		const m = this._models.get(key) as T | undefined;
		if (m !== undefined) return m;
		for (const project of this._projects) {
			const pm = project.getModel<T>(key);
			if (pm !== undefined) return pm;
		}
		return undefined;
	}

	/**
	 * Retrieve all models of a given type. Searches workspace models and all
	 * projects, so features can discover controllers across multiple projects.
	 */
	public getModels<T extends SourceFileProvider>(ctor: new (...args: never[]) => T): T[] {
		return [
			...[...this._models.values()].filter((m): m is T => m instanceof ctor),
			...this._projects.flatMap((p) => p.getModels(ctor)),
		];
	}

	/** Render all models and projects into files, then write everything to disk. */
	public async scaffold(): Promise<void> {
		const allFiles = [
			...this.files,
			...[...this._models.values()].flatMap((m) => m.files()),
			...this._projects.flatMap((p) => p.files()),
		];

		await Promise.all(
			allFiles.map(async (file) => {
				const fullPath = join(this.targetDir, file.filePath);
				await mkdir(dirname(fullPath), { recursive: true });
				await writeFile(fullPath, file.content);
			}),
		);
	}
}
