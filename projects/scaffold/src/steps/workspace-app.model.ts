import type { WorkspaceChanges } from "../templates/workspace-changes.model.js";
import type { Orm } from "../webapi/database-provider.js";
import { AppSource } from "./app-source.model.js";

/** An app a step changes: its folder under `projects/`, and its local port. */
export type AppTarget = { name: string; port: number };

type Manifest = { dependencies?: Record<string, string> };

const identifier = (id: string) => `m${id.replaceAll("-", "_")}`;

/** One app in a workspace, as the changes so far leave it. */
export class WorkspaceApp {
	public readonly source: AppSource;

	public constructor(
		private readonly changes: WorkspaceChanges,
		public readonly name: string,
	) {
		this.source = new AppSource(changes, name);
	}

	/** The ORM the app maps its tables with, from the provider package it depends on. */
	public get orm(): Orm | undefined {
		const text = this.changes.read(`projects/${this.name}/package.json`);
		const dependencies =
			text == null ? {} : ((JSON.parse(text) as Manifest).dependencies ?? {});
		if ("@decohere/data-mikro-orm" in dependencies) return "mikro-orm";
		if ("@decohere/data-typeorm" in dependencies) return "typeorm";
		return undefined;
	}

	/** True when the app checks tokens: its app.ts uses the auth plugin. */
	public get hasAuth(): boolean {
		return this.source.text.includes(".use(auth(");
	}

	/**
	 * Writes the app's `src/migrations/index.ts` as the db commands do: every migration in the
	 * folder, in id order. So a step that adds a migration lists it beside the app's own.
	 */
	public writeMigrationIndex(): void {
		const dir = `projects/${this.name}/src/migrations`;
		const ids = this.changes
			.listFiles(dir)
			.filter((file) => /^\d{8}-\d{6}-.+\.ts$/.test(file))
			.map((file) => file.slice(0, -".ts".length));
		if (ids.length === 0) return;
		const imports = ids.map((id) => `import ${identifier(id)} from "./${id}.js";\n`).join("");
		this.changes.write(
			`${dir}/index.ts`,
			`// Written by the db commands: every migration in this folder, in id order.
import type { Migration } from "@decohere/data";
${imports}
export const migrations: Migration[] = [${ids.map(identifier).join(", ")}];
`,
		);
	}
}
