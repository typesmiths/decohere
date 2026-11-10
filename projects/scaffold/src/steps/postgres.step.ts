import { templates } from "../templates/templates.js";
import type { WorkspaceChanges } from "../templates/workspace-changes.js";
import type { Orm } from "../webapi/database-provider.js";
import { appSource, type SourceEdit } from "./app-source.js";
import { type AppTarget, apps } from "./apps.js";
import { migrations } from "./migrations.js";

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
		apply: appSource.insertBefore(/^[ \t]*\.build\(\)/, call),
		byHand: [`and, before .build(): ${call.replaceAll(/\n\t*/g, " ")}`],
	};
}

/**
 * `decohere add postgres`: a local Postgres in the Dev Container, a database for each app, and a
 * sample table mapped with the ORM. An app that already maps with another ORM is left alone.
 */
function apply(changes: WorkspaceChanges, workspace: string, targets: AppTarget[], orm: Orm) {
	for (const { name: app, port } of targets) {
		const current = apps.ormOf(changes, app);
		if (current != null && current !== orm) {
			changes.tellByHand(`projects/${app}/package.json`, [
				`This app already uses ${current}, so ${orm} wasn't added.`,
			]);
			continue;
		}
		const names = { workspace, app, port };
		templates.apply(changes, "steps/postgres", names);
		templates.apply(changes, `steps/${orm}`, names);
		migrations.writeIndex(changes, app);
		appSource.edit(changes, app, [providerEdit(orm, app)]);
	}
}

export const postgresStep = { apply };
