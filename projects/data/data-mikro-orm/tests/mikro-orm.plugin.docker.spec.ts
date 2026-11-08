// mikroOrm() in a running app, against Postgres, the way a generated app uses it in development:
// it bootstraps the database and roles, creates the tables, seeds, gives each request its own
// unit of work, reports ready, and closes when the app stops. Needs Docker: `pnpm test:docker`.
import "reflect-metadata";
import { Builder, type BuilderPlugin } from "@decohere/core/hosting";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import type { IContainer } from "@decohere/core/composition";
import type { Constructable } from "@decohere/core/reflection";
import { ServiceContainerBuilder } from "@decohere/crucible";
import {
	type ConnectionInfo,
	DatabaseConfig,
	DEFAULT_DATA_SOURCE,
	type IUnitOfWork,
} from "@decohere/data";
import { defineEntity, p } from "@mikro-orm/core";
import type { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type PostgresContainer,
	startPostgres,
} from "../../data/tests/postgres/postgres-container.js";
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

/** The app's container, which App keeps to itself, caught the way a plugin sees it. */
function containerOf() {
	let container: IContainer;
	const plugin: BuilderPlugin = (builder) =>
		builder.registerPostBuildStep((c) => {
			container = c;
		});
	return { plugin, get: () => container };
}

describe("mikroOrm() in an app", () => {
	let postgres: PostgresContainer;

	beforeAll(async () => {
		// Bootstrap and synchronize are for development only, and refuse to run elsewhere.
		vi.stubEnv("NODE_ENV", "development");
		postgres = await startPostgres();
		await postgres.superuser.query(
			"CREATE ROLE decohere_bootstrap LOGIN PASSWORD 'bootstrap-pw' CREATEDB CREATEROLE NOSUPERUSER NOBYPASSRLS",
		);
	});

	afterAll(async () => {
		vi.unstubAllEnvs();
		await postgres?.stop();
	});

	it("bootstraps, creates tables, seeds, and gives each request its own unit of work", async () => {
		const connection: ConnectionInfo = {
			name: "notes",
			provider: "postgres",
			host: postgres.host,
			port: postgres.port,
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
		const probe = containerOf();
		const app = await Builder.create(new ServiceContainerBuilder(), {
			applicationName: "notes.api",
		})
			.withServices((c) =>
				c.registerSingleton(ConfigurationServiceToken, new StaticConfig(connection)),
			)
			.use(
				mikroOrm({
					entities: [NoteSchema],
					seed: async (orm) => {
						const em = orm.em.fork();
						await em.persist(new Note("seeded")).flush();
					},
				}),
			)
			.use(probe.plugin)
			.build();

		{
			await using scope = probe.get().beginScope("first request");
			const uow = scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE);
			expect(scope.resolve(DEFAULT_DATA_SOURCE)).toBe(uow);
			uow.add(new Note("from a request"));
			await uow.commit();
		}
		{
			await using scope = probe.get().beginScope("second request");
			const uow = scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE);
			const notes = await uow.find(Note, { orderBy: { id: "asc" } });
			expect(notes.map((n) => n.text)).toEqual(["seeded", "from a request"]);
		}

		const orm = probe.get().resolve<MikroORM>(MikroOrmToken);
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
