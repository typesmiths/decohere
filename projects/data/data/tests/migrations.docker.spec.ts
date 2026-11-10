// Decohere migrations with each provider, in an app on a real Postgres: the provider's schema diff,
// taken as the migrate role, holds only the data source's own tables; applied through the
// migrator it leaves nothing to diff; and migrateOnStart applies it when the app starts.
// Needs Docker: `pnpm test:docker`.
import "reflect-metadata";
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
	defineMigration,
	type Migration,
	type MigrationTarget,
	MigrationTargetToken,
	type SchemaDiff,
} from "@decohere/data";
import { mikroOrm } from "@decohere/data-mikro-orm";
import { postgres } from "@decohere/data-postgres";
import { typeOrm } from "@decohere/data-typeorm";
import { defineEntity, p } from "@mikro-orm/core";
import { Client } from "pg";
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type PostgresContainer,
	startPostgres,
} from "../../data-postgres/tests/postgres-container.js";

@Entity({ name: "note" })
class TypeOrmNote {
	@PrimaryGeneratedColumn()
	public id!: number;

	@Column({ type: "text" })
	public text!: string;
}

class MikroNote {
	public id!: number;
	public text!: string;
}

const MikroNoteSchema = defineEntity({
	class: MikroNote,
	tableName: "note",
	properties: { id: p.integer().primary().autoincrement(), text: p.text() },
});

/** A service of the app's that a data migration uses. */
class Greeting {
	public text(n: number) {
		return `hello ${n}`;
	}
}

class StaticConfig implements IConfigurationService {
	public readonly dataSources = [];
	public constructor(private readonly connection: ConnectionInfo) {}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		const config = new DatabaseConfig();
		if (type === DatabaseConfig) config.dataSources = [this.connection];
		return config as unknown as T;
	}
}

type ProviderCase = {
	name: string;
	plugin: (migrations: readonly Migration[]) => BuilderPlugin;
};

const providers: ProviderCase[] = [
	{
		name: "MikroORM",
		plugin: (migrations) =>
			mikroOrm({ entities: [MikroNoteSchema], database: postgres, migrations }),
	},
	{
		name: "TypeORM",
		plugin: (migrations) =>
			typeOrm({ entities: [TypeOrmNote], database: postgres, migrations }),
	},
];

/** A schema migration holding a diff, as `db generate` writes one. */
function schemaMigration(id: string, diff: SchemaDiff): Migration {
	return {
		id,
		async up({ sql }) {
			for (const statement of diff.up) await sql(statement);
		},
		async down({ sql }) {
			for (const statement of diff.down) await sql(statement);
		},
	};
}

const greetings = defineMigration({
	id: "20261110-090100-greetings",
	async up({ sql, container, batch }) {
		const greeting = container.resolve(Greeting);
		await sql("insert into note (text) select '' from generate_series(1, 5)");
		await batch<{ id: number }>(
			"select id from note where text = '' order by id limit $1",
			2,
			async (rows) => {
				for (const { id } of rows) {
					await sql("update note set text = $1 where id = $2", [greeting.text(id), id]);
				}
			},
		);
	},
	async down({ sql }) {
		await sql("delete from note");
	},
});

describe.each(providers)("migrations with $name", ({ name, plugin }) => {
	let server: PostgresContainer;
	let databases = 0;

	beforeAll(async () => {
		// Bootstrap and migrateOnStart are for development.
		vi.stubEnv("NODE_ENV", "development");
		server = await startPostgres();
		await server.superuser.query(
			"CREATE ROLE decohere_bootstrap LOGIN PASSWORD 'bootstrap-pw' CREATEDB CREATEROLE NOSUPERUSER NOBYPASSRLS",
		);
	});

	afterAll(async () => {
		vi.unstubAllEnvs();
		await server?.stop();
	});

	function connection(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
		databases += 1;
		return {
			name: "notes",
			provider: "postgres",
			host: server.host,
			port: server.port,
			database: `notes_${name.toLowerCase()}_${databases}`,
			username: "notes_app",
			password: "app-pw",
			schema: "notes",
			synchronize: false,
			seed: false,
			bootstrap: true,
			adminUser: "decohere_bootstrap",
			adminPassword: "bootstrap-pw",
			migrateUsername: "notes_migrate",
			migratePassword: "migrate-pw",
			...overrides,
		};
	}

	function build(info: ConnectionInfo, migrations: readonly Migration[] = []) {
		return Builder.create(new ServiceContainerBuilder(), { applicationName: "notes.api" })
			.withServices((c) => {
				c.registerSingleton(ConfigurationServiceToken, new StaticConfig(info));
				c.registerSingleton(Greeting);
			})
			.use(plugin(migrations))
			.build();
	}

	async function superuser<R extends object>(
		info: ConnectionInfo,
		text: string,
	): Promise<R[]> {
		const client = new Client({
			host: server.host,
			port: server.port,
			database: info.database,
			user: "postgres",
			password: "postgres",
		});
		await client.connect();
		try {
			return (await client.query<R>(text)).rows;
		} finally {
			await client.end();
		}
	}

	it("diffs only its own schema, as the migrate role, and has nothing left to diff once applied", async () => {
		const info = connection();
		await using app = await build(info);
		// Another app's table in the same database, out of the migrate role's reach.
		await superuser(info, "create schema billing; create table billing.invoice (id int)");
		const [target] = app.services.resolveMany<MigrationTarget>(MigrationTargetToken);

		const diff = await target.diff();

		expect(diff.up.join("\n")).toMatch(/create table "notes"\."note"/i);
		expect([...diff.up, ...diff.down].join("\n")).not.toMatch(
			/billing|invoice|decohere_migrations|create schema/i,
		);

		const createNotes = schemaMigration("20261110-090000-create-notes", diff);
		const source = { ...target.source, migrations: [createNotes, greetings] };
		const container = app.services;
		expect(await target.migrator.migrate(source, { container })).toEqual([
			createNotes.id,
			greetings.id,
		]);
		expect(await target.diff()).toEqual({ up: [], down: [] });
		expect(await superuser(info, "select text from notes.note order by id")).toEqual(
			[1, 2, 3, 4, 5].map((n) => ({ text: `hello ${n}` })),
		);

		expect(await target.migrator.revert(source, { container })).toBe(greetings.id);
		expect(await target.migrator.revert(source, { container })).toBe(createNotes.id);
		expect(await superuser(info, "select to_regclass('notes.note') as found")).toEqual([
			{ found: null },
		]);

		expect(await target.migrator.migrate(source, { container })).toHaveLength(2);
		expect(await target.diff()).toEqual({ up: [], down: [] });
	});

	it("applies pending migrations when the app starts with migrateOnStart, not when it is built", async () => {
		const generated = connection();
		let diff: SchemaDiff;
		{
			await using app = await build(generated);
			const [target] = app.services.resolveMany<MigrationTarget>(MigrationTargetToken);
			diff = await target.diff();
		}
		const info = connection({ migrateOnStart: true });
		const migrations = [schemaMigration("20261110-090000-create-notes", diff), greetings];
		await using app = await build(info, migrations);
		expect(await superuser(info, "select to_regclass('notes.note') as found")).toEqual([
			{ found: null },
		]);

		await app.start({ port: 0, shutdownSignals: false });

		expect(await superuser(info, "select count(*)::int as notes from notes.note")).toEqual([
			{ notes: 5 },
		]);
		expect(
			await superuser(info, "select id from notes.decohere_migrations order by id"),
		).toEqual(migrations.map(({ id }) => ({ id })));
	});
});
