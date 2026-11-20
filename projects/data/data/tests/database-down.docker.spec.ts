// An app whose database is down when it starts, with each provider: it builds and starts anyway,
// answers that it isn't ready, turns requests for the database away as unavailable (HTTP 503), and
// holds back its hosted services. Once the database comes up, the start step's retry bootstraps,
// connects and creates the tables, and the app serves. A TCP proxy stands in for the network
// between them. Needs Docker: `pnpm test:docker`.
import "reflect-metadata";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import {
	Builder,
	type BuilderPlugin,
	DependencyUnavailableError,
	type HostedService,
	type HostedServiceHost,
	HostedServiceHostToken,
} from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import { ServiceContainerBuilder } from "@decohere/crucible";
import {
	type ConnectionInfo,
	DatabaseConfig,
	DEFAULT_DATA_SOURCE,
	type IUnitOfWork,
} from "@decohere/data";
import { mikroOrm } from "@decohere/data-mikro-orm";
import { postgres } from "@decohere/data-postgres";
import { typeOrm } from "@decohere/data-typeorm";
import { defineEntity, p } from "@mikro-orm/core";
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type PostgresContainer,
	startPostgres,
} from "../../data-postgres/tests/postgres-container.js";
import { startTcpProxy, type TcpProxy } from "../../data-postgres/tests/tcp-proxy.js";

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

class StaticConfig implements IConfigurationService {
	public readonly dataSources = [];
	public constructor(private readonly connection: ConnectionInfo) {}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		const config = new DatabaseConfig();
		if (type === DatabaseConfig) config.dataSources = [this.connection];
		return config as unknown as T;
	}
}

let workerStarted = false;

/** A hosted service that needs the database's tables. */
class Worker implements HostedService {
	public start() {
		workerStarted = true;
	}
}

type ProviderCase = {
	name: string;
	step: string;
	plugin: BuilderPlugin;
	note(text: string): object;
	Note: Constructable;
};

const providers: ProviderCase[] = [
	{
		name: "MikroORM",
		step: "mikro-orm data sources",
		plugin: mikroOrm({ entities: [MikroNoteSchema], database: postgres }),
		note: (text) => Object.assign(new MikroNote(), { text }),
		Note: MikroNote,
	},
	{
		name: "TypeORM",
		step: "typeorm data sources",
		plugin: typeOrm({ entities: [TypeOrmNote], database: postgres }),
		note: (text) => Object.assign(new TypeOrmNote(), { text }),
		Note: TypeOrmNote,
	},
];

async function until(condition: () => boolean, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("Timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

describe.each(providers)("an app with $name whose database is down at start", (provider) => {
	let server: PostgresContainer;
	let proxy: TcpProxy;

	beforeAll(async () => {
		// Bootstrap and synchronize are for development.
		vi.stubEnv("NODE_ENV", "development");
		server = await startPostgres();
		await server.superuser.query(
			"CREATE ROLE decohere_bootstrap LOGIN PASSWORD 'bootstrap-pw' CREATEDB CREATEROLE NOSUPERUSER NOBYPASSRLS",
		);
		proxy = await startTcpProxy(server);
	});

	afterAll(async () => {
		vi.unstubAllEnvs();
		await proxy?.stop();
		await server?.stop();
	});

	it("starts, isn't ready and turns requests away until the database is up, then serves", async () => {
		workerStarted = false;
		const connection: ConnectionInfo = {
			name: "notes",
			provider: "postgres",
			host: proxy.host,
			port: proxy.port,
			database: `notes_${provider.name.toLowerCase()}`,
			username: "notes_app",
			password: "app-pw",
			schema: "notes",
			synchronize: true,
			seed: false,
			bootstrap: true,
			adminUser: "decohere_bootstrap",
			adminPassword: "bootstrap-pw",
			migrateUsername: "notes_migrate",
			migratePassword: "migrate-pw",
		};
		await using app = await Builder.create(new ServiceContainerBuilder(), {
			applicationName: "notes.api",
		})
			.withServices((c) =>
				c.registerSingleton(ConfigurationServiceToken, new StaticConfig(connection)),
			)
			.use(provider.plugin)
			.withHostedService(Worker)
			.build();

		await app.start({
			port: 0,
			shutdownSignals: false,
			startRetry: { initialMs: 50, maxMs: 200 },
		});
		const host = app.services.resolve<HostedServiceHost>(HostedServiceHostToken);

		expect(host.readinessChecks().map((c) => c.name)).toEqual([provider.step]);
		expect(workerStarted).toBe(false);
		{
			await using scope = app.services.beginScope("a request");
			expect(() => scope.resolve(DEFAULT_DATA_SOURCE)).toThrow(DependencyUnavailableError);
		}

		proxy.up();
		await until(() => workerStarted);

		expect(host.readinessChecks().map((c) => c.name)).toEqual([]);
		{
			await using scope = app.services.beginScope("a later request");
			const uow = scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE);
			uow.add(provider.note("written once the database came up"));
			await uow.commit();
		}
		{
			await using scope = app.services.beginScope("a read");
			const uow = scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE);
			const notes = (await uow.find(provider.Note, {})) as { text: string }[];
			expect(notes.map((n) => n.text)).toEqual(["written once the database came up"]);
		}
	});
});
