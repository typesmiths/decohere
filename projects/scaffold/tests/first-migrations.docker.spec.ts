// A generated app's first migrations are exactly what its ORM's `db generate` would write for the
// mappings beside them, so the app's first `db generate` finds nothing until a mapping changes.
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
import type { Orm } from "../src/webapi/database-provider.js";
import {
	sampleTable,
	type TableTemplate,
	userTable,
} from "../src/webapi/features/orm-templates.js";

// vitest.setup.ts swaps node:fs for memfs; the templates go on the real disk so they can import packages.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

class StaticConfig implements IConfigurationService {
	public readonly dataSources = [];
	public constructor(private readonly connection: ConnectionInfo) {}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		const config = new DatabaseConfig();
		if (type === DatabaseConfig) config.dataSources = [this.connection];
		return config as unknown as T;
	}
}

/** The scaffold's own migration, as a migration: what its file does. */
function asMigration(id: string, table: TableTemplate): Migration {
	return {
		id,
		async up({ sql }) {
			for (const statement of table.migration.up) await sql(statement);
		},
		async down({ sql }) {
			for (const statement of table.migration.down) await sql(statement);
		},
	};
}

const cases: { orm: Orm; tables: () => TableTemplate[] }[] = [
	{ orm: "mikro-orm", tables: () => [sampleTable("mikro-orm")] },
	{ orm: "mikro-orm", tables: () => [sampleTable("mikro-orm"), userTable("mikro-orm")] },
	{ orm: "typeorm", tables: () => [sampleTable("typeorm")] },
	{ orm: "typeorm", tables: () => [sampleTable("typeorm"), userTable("typeorm")] },
];

describe("a generated app's first migrations", () => {
	let server: PostgresContainer;
	let folder: string;
	let databases = 0;

	beforeAll(async () => {
		vi.stubEnv("NODE_ENV", "development");
		server = await startPostgres({ trust: true });
		folder = realFs.mkdtempSync(join(import.meta.dirname, ".first-migrations-"));
	});

	afterAll(async () => {
		vi.unstubAllEnvs();
		if (folder) realFs.rmSync(folder, { recursive: true, force: true });
		await server?.stop();
	});

	/** Write a table's files under a folder of their own and import its mapping. */
	async function mapping(orm: Orm, table: TableTemplate): Promise<unknown> {
		const root = join(folder, orm);
		for (const file of table.files) {
			const path = join(root, file.filePath);
			realFs.mkdirSync(join(path, ".."), { recursive: true });
			realFs.writeFileSync(path, file.content);
		}
		const module = (await import(
			pathToFileURL(
				join(root, table.entity.importPath.replace(/^\.\//, "src/").replace(/\.js$/, ".ts")),
			).href
		)) as Record<string, unknown>;
		return module[table.entity.className];
	}

	it.each(
		cases.map(
			(c) =>
				[
					c.orm,
					c
						.tables()
						.map((t) => t.migration.name)
						.join(" + "),
					c,
				] as const,
		),
	)(
		"%s, %s: nothing left to generate once they're applied",
		async (_orm, _tables, { orm, tables }) => {
			const templates = tables();
			const entities = await Promise.all(templates.map((t) => mapping(orm, t)));
			const migrations = templates.map((t, i) =>
				asMigration(`20261108-12000${i}-${t.migration.name}`, t),
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
