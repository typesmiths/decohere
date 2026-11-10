// mikroOrm() in a running app, against Postgres, the way a generated app uses it in development:
// building it bootstraps the database and roles and connects; starting it creates the tables and
// seeds. Each request gets its own unit of work, and it closes when the app stops. Needs Docker: `pnpm test:docker`.
import "reflect-metadata";
import { Builder } from "@decohere/core/hosting";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { ServiceContainerBuilder } from "@decohere/crucible";
import {
	type ConnectionInfo,
	DatabaseConfig,
	DEFAULT_DATA_SOURCE,
	type IUnitOfWork,
} from "@decohere/data";
import { postgres } from "@decohere/data-postgres";
import { defineEntity, p } from "@mikro-orm/core";
import type { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type PostgresContainer,
	startPostgres,
} from "../../data-postgres/tests/postgres-container.js";
import { mikroOrm, MikroOrmToken } from "../src/index.js";

class Note {
	public id!: number;
	public constructor(public text: string) {}
}

const NoteSchema = defineEntity({
	class: Note,
	tableName: "note",
	properties: { id: p.integer().primary().autoincrement(), text: p.text() },
});

class StaticConfig implements IConfigurationService {
	public readonly dataSources = [];
	public constructor(private readonly connection: ConnectionInfo) {}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		const config = new DatabaseConfig();
		if (type === DatabaseConfig) config.dataSources = [this.connection];
		return config as unknown as T;
	}
}

describe("mikroOrm() in an app", () => {
	let server: PostgresContainer;

	beforeAll(async () => {
		// Bootstrap and synchronize are for development only, and refuse to run elsewhere.
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

	it("bootstraps when built, creates tables and seeds when started, and gives each request its own unit of work", async () => {
		const connection: ConnectionInfo = {
			name: "notes",
			provider: "postgres",
			host: server.host,
			port: server.port,
			database: "notes_dev",
			username: "notes_app",
			password: "app-pw",
			schema: "notes",
			synchronize: true,
			seed: true,
			bootstrap: true,
			adminUser: "decohere_bootstrap",
			adminPassword: "bootstrap-pw",
			migrateUsername: "notes_migrate",
			migratePassword: "migrate-pw",
		};
		const app = await Builder.create(new ServiceContainerBuilder(), {
			applicationName: "notes.api",
		})
			.withServices((c) =>
				c.registerSingleton(ConfigurationServiceToken, new StaticConfig(connection)),
			)
			.use(
				mikroOrm({
					entities: [NoteSchema],
					database: postgres,
					seed: async (orm) => {
						const em = orm.em.fork();
						await em.persist(new Note("seeded")).flush();
					},
				}),
			)
			.build();
		const orm = app.services.resolve<MikroORM>(MikroOrmToken);
		const table = async () =>
			(
				await orm.em
					.getConnection()
					.execute<{ found: string | null }[]>("select to_regclass('notes.note') as found")
			)[0].found;
		expect(await table()).toBeNull();

		await app.start({ port: 0, shutdownSignals: false });
		expect(await table()).toBe("notes.note");

		{
			await using scope = app.services.beginScope("first request");
			const uow = scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE);
			expect(scope.resolve(DEFAULT_DATA_SOURCE)).toBe(uow);
			uow.add(new Note("from a request"));
			await uow.commit();
		}
		{
			await using scope = app.services.beginScope("second request");
			const uow = scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE);
			const notes = await uow.find(Note, { orderBy: { id: "asc" } });
			expect(notes.map((n) => n.text)).toEqual(["seeded", "from a request"]);
		}

		const [who] = await orm.em
			.getConnection()
			.execute<{ user: string; app: string }[]>(
				"select current_user as user, current_setting('application_name') as app",
			);
		expect(who).toEqual({ user: "notes_app", app: "notes.api" });

		await app.dispose();
		expect(await orm.isConnected()).toBe(false);
	});
});
