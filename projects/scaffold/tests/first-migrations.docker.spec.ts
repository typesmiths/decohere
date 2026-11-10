// A generated app's first migrations are exactly what its ORM's `db generate` would write for the
// mappings beside them, so the app's first `db generate` finds nothing until a mapping changes.
// The mappings and migrations are the add steps' own files, imported where they are.
// Needs Docker: `pnpm test:docker`.
import "reflect-metadata";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import { Builder, type BuilderPlugin } from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import { ServiceContainerBuilder } from "@decohere/crucible";
import {
	type ConnectionInfo,
	DatabaseConfig,
	type Migration,
	type MigrationTarget,
	MigrationTargetToken,
} from "@decohere/data";
import { mikroOrm } from "@decohere/data-mikro-orm";
import { postgres } from "@decohere/data-postgres";
import { typeOrm } from "@decohere/data-typeorm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type PostgresContainer,
	startPostgres,
} from "../../data/data-postgres/tests/postgres-container.js";
import { templates } from "../src/templates/templates.js";
import type { Orm } from "../src/webapi/database-provider.js";

class StaticConfig implements IConfigurationService {
	public readonly dataSources = [];
	public constructor(private readonly connection: ConnectionInfo) {}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		const config = new DatabaseConfig();
		if (type === DatabaseConfig) config.dataSources = [this.connection];
		return config as unknown as T;
	}
}

/** A table an add step maps: the step's folder, its mapping, and its migration's name. */
type Table = { step: string; mapping: string; exported: string; migration: string };

function table(orm: Orm, step: string, entity: "sample" | "user"): Table {
	const Entity = entity === "sample" ? "SampleEntity" : "UserEntity";
	return orm === "mikro-orm"
		? {
				step,
				mapping: `mappings/${entity}.mapping.ts`,
				exported: `${Entity}Mapping`,
				migration: `create-${entity}-entity`,
			}
		: {
				step,
				mapping: `entities/${entity}.entity.ts`,
				exported: Entity,
				migration: `create-${entity}-entity`,
			};
}

async function load(path: string): Promise<Record<string, unknown>> {
	return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
}

const src = (step: string) => join(templates.dir(), "steps", step, "projects/app-name/src");

const cases: { orm: Orm; tables: Table[] }[] = [
	{ orm: "mikro-orm", tables: [table("mikro-orm", "mikro-orm", "sample")] },
	{
		orm: "mikro-orm",
		tables: [
			table("mikro-orm", "mikro-orm", "sample"),
			table("mikro-orm", "users-mikro-orm", "user"),
		],
	},
	{ orm: "typeorm", tables: [table("typeorm", "typeorm", "sample")] },
	{
		orm: "typeorm",
		tables: [table("typeorm", "typeorm", "sample"), table("typeorm", "users-typeorm", "user")],
	},
];

describe("a generated app's first migrations", () => {
	let server: PostgresContainer;
	let databases = 0;

	beforeAll(async () => {
		vi.stubEnv("NODE_ENV", "development");
		server = await startPostgres({ trust: true });
	});

	afterAll(async () => {
		vi.unstubAllEnvs();
		await server?.stop();
	});

	it.each(cases.map((c) => [c.orm, c.tables.map((t) => t.migration).join(" + "), c] as const))(
		"%s, %s: nothing left to generate once they're applied",
		async (_orm, _tables, { orm, tables }) => {
			const entities = await Promise.all(
				tables.map(async (t) => (await load(join(src(t.step), t.mapping)))[t.exported]),
			);
			const migrations = await Promise.all(
				tables.map(
					async (t) =>
						(await load(join(src(t.step), `migrations/00000000-000000-${t.migration}.ts`)))
							.default as Migration,
				),
			);
			databases += 1;
			const info: ConnectionInfo = {
				name: "api",
				provider: "postgres",
				host: server.host,
				port: server.port,
				database: `first_${databases}`,
				username: "first_app",
				auth: "trust",
				synchronize: false,
				migrateOnStart: true,
				seed: false,
				bootstrap: true,
				adminUser: "postgres",
				migrateUsername: "first_migrate",
			};
			const plugin: BuilderPlugin =
				orm === "mikro-orm"
					? mikroOrm({ entities: entities as never, database: postgres, migrations })
					: typeOrm({ entities: entities as never, database: postgres, migrations });
			await using app = await Builder.create(new ServiceContainerBuilder(), {
				applicationName: "first",
			})
				.withServices((c) =>
					c.registerSingleton(ConfigurationServiceToken, new StaticConfig(info)),
				)
				.use(plugin)
				.build();
			await app.start({ port: 0, shutdownSignals: false });

			const [target] = app.services.resolveMany<MigrationTarget>(MigrationTargetToken);
			expect(await target.diff()).toEqual({ up: [], down: [] });
		},
	);
});
