import { Templates } from "../templates/templates.service.js";
import type { WorkspaceChanges } from "../templates/workspace-changes.model.js";
import type { Orm } from "../webapi/database-provider.js";
import { AppSource, type SourceEdit } from "./app-source.model.js";
import { type AppTarget, WorkspaceApp } from "./workspace-app.model.js";

const PROVIDER: Record<
	Orm,
	{ plugin: string; from: string; entity: string; entityFrom: string }
> = {
	"mikro-orm": {
		plugin: "mikroOrm",
		from: "@decohere/data-mikro-orm",
		entity: "SampleEntityMapping",
		entityFrom: "./mappings/sample.mapping.js",
	},
	typeorm: {
		plugin: "typeOrm",
		from: "@decohere/data-typeorm",
		entity: "SampleEntity",
		entityFrom: "./entities/sample.entity.js",
	},
};

/** The provider plugin in app.ts: the app's data source, its tables and its migrations. */
function providerEdit(orm: Orm, app: string): SourceEdit {
	const { plugin, from, entity, entityFrom } = PROVIDER[orm];
	const call = [
		".use(",
		`\t${plugin}({`,
		`\t\tname: "${app}",`,
		`\t\tentities: [${entity}],`,
		"\t\trepositories: [SampleEntityRepository],",
		"\t\tdatabase: postgres,",
		"\t\tmigrations,",
		"\t}),",
		")",
	].join("\n");
	return {
		imports: [
			`import { ${plugin} } from "${from}";`,
			'import { postgres } from "@decohere/data-postgres";',
			`import { ${entity} } from "${entityFrom}";`,
			'import { migrations } from "./migrations/index.js";',
			'import { SampleEntityRepository } from "./repositories/sample.repository.js";',
		],
		isDone: (source) => source.includes(`${plugin}(`),
		apply: AppSource.insertBefore(/^[ \t]*\.build\(\)/, call),
		byHand: [`and, before .build(): ${call.replaceAll(/\n\t*/g, " ")}`],
	};
}

/**
 * `decohere add postgres`: a local Postgres in the Dev Container, a database for each app, and a
 * sample table mapped with the ORM. An app that already maps with another ORM is left alone.
 */
export class PostgresStep {
	public constructor(
		private readonly changes: WorkspaceChanges,
		private readonly templates = new Templates(),
	) {}

	public apply(workspace: string, targets: AppTarget[], orm: Orm): void {
		for (const { name, port } of targets) {
			const app = new WorkspaceApp(this.changes, name);
			const current = app.orm;
			if (current != null && current !== orm) {
				this.changes.tellByHand(`projects/${name}/package.json`, [
					`This app already uses ${current}, so ${orm} wasn't added.`,
				]);
				continue;
			}
			const names = { workspace, app: name, port };
			this.templates.apply(this.changes, "steps/postgres", names);
			this.templates.apply(this.changes, `steps/${orm}`, names);
			app.writeMigrationIndex();
			app.source.edit([providerEdit(orm, name)]);
		}
	}
}
