import type { BuilderPlugin } from "@decohere/core/hosting";
import {
	DependencyUnavailableError,
	type IReadinessCheck,
	ReadinessCheckToken,
} from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import type { ContainerBuilder } from "@decohere/crucible";
import {
	type ConnectionInfo,
	DatabaseConfig,
	type DatabaseSupport,
	DataConfigurationError,
	dataSources,
	type Migration,
	type MigrationTarget,
	MigrationTargetToken,
	type OutboxMapper,
	type SchemaDiff,
	type StartingDataSource,
} from "@decohere/data";
import { scribe } from "@decohere/scribe";
import { type Options, MikroORM } from "@mikro-orm/postgresql";
import { mikroOrmToken } from "./inject-mikro-orm.js";
import { MikroOrmUnitOfWork } from "./mikro-orm.unit-of-work.js";

const HISTORY_TABLE = "decohere_migrations";

export type MikroOrmModuleConfig = {
	/** The data source's name in the `database` config. Required when there is more than one. */
	name?: string | symbol;
	/** The mappings: `defineEntity({ class, … })` results or `EntitySchema`s. */
	entities: NonNullable<Options["entities"]>;
	repositories?: Constructable[];
	/**
	 * The database's package: `postgres` from `@decohere/data-postgres`. It creates the database,
	 * roles and schema when the config asks, and runs migrations.
	 */
	database?: DatabaseSupport;
	/** The data source's migrations: `migrations` from its migrations folder's `index.ts`. */
	migrations?: readonly Migration[];
	/** Writes the events aggregates raise to an outbox entity, in the same commit. */
	outbox?: OutboxMapper;
	/** Runs when the app starts, after migrations, when the data source's `seed` is on. */
	seed?: (orm: MikroORM) => Promise<void>;
};

export type MikroOrmModuleOptions = {
	applicationName: string;
	databaseConfig: DatabaseConfig;
	moduleConfigurations: MikroOrmModuleConfig[];
	containerBuilder: ContainerBuilder;
};

/** A data source the module registered: its container key, and what the app does with it on start. */
export type OpenedMikroOrm = { name: string | symbol; starting: StartingDataSource };

/** What {@link MikroOrmModule.configure} registered, and how to bring it all up. */
export type ConfiguredMikroOrm = {
	sources: OpenedMikroOrm[];
	/** Bootstrap, then connect each data source: `dataSources.open`. */
	open(): Promise<void>;
};

export class MikroOrmModule {
	/**
	 * Checks the config and registers a MikroORM instance per data source, and what each one serves,
	 * without connecting: the app's start step connects (`open`), and is retried while the
	 * database is down.
	 */
	public async configure(options: MikroOrmModuleOptions): Promise<ConfiguredMikroOrm> {
		const { applicationName, databaseConfig, moduleConfigurations, containerBuilder } =
			options;
		const resolved = dataSources.resolve(databaseConfig, moduleConfigurations);
		const bootstrap = moduleConfigurations.find((m) => m.database)?.database?.bootstrap;
		dataSources.check(
			resolved.map((r) => r.connectionInfo),
			{ bootstrap },
		);
		const sources: OpenedMikroOrm[] = [];
		const open = () =>
			dataSources.open(
				sources.map((s) => s.starting),
				{ applicationName, bootstrap },
			);
		for (const { name, connectionInfo, module } of resolved) {
			const orm = await this.create(applicationName, name, connectionInfo, module);
			let connected = false;
			containerBuilder.registerSingleton(mikroOrmToken(name), orm);
			containerBuilder.registerRequestScoped(name, () => {
				if (!connected) {
					throw new DependencyUnavailableError(
						`data source "${String(name)}"`,
						"not connected yet",
					);
				}
				return new MikroOrmUnitOfWork(orm.em, { outbox: module.outbox });
			});
			containerBuilder.registerSingleton(ReadinessCheckToken, readinessCheck(name, orm));
			for (const repository of module.repositories ?? []) {
				containerBuilder.registerRequestScoped(repository);
			}
			const migrations = migrationTarget(applicationName, connectionInfo, module, open);
			if (migrations != null) {
				containerBuilder.registerSingleton(MigrationTargetToken, migrations);
			}
			sources.push({
				name,
				starting: {
					connection: connectionInfo,
					migrations,
					connect: async () => {
						if (connected) return;
						await orm.connect();
						const status = await orm.checkConnection();
						if ("reason" in status) throw new Error(status.reason, { cause: status.error });
						connected = true;
					},
					synchronize: () => synchronize(orm),
					seed: async () => module.seed?.(orm),
				},
			});
		}
		return { sources, open };
	}

	/** Builds the instance and reads the mappings; MikroORM connects only on `connect()`. */
	private async create(
		applicationName: string,
		name: string | symbol,
		connection: ConnectionInfo,
		module: MikroOrmModuleConfig,
	): Promise<MikroORM> {
		if (connection.provider !== "postgres") {
			throw new DataConfigurationError(
				`Data source ${connection.name}: the MikroORM provider supports postgres, not ${connection.provider}`,
			);
		}
		const log = scribe.logger(`MikroORM:${String(name)}`);
		return MikroORM.init({
			host: connection.host,
			port: connection.port,
			dbName: connection.database,
			user: connection.username,
			password: connection.password,
			schema: connection.schema,
			entities: module.entities,
			driverOptions: { application_name: applicationName },
			// The bootstrap creates the database, as a role allowed to; the app's role may not.
			ensureDatabase: false,
			debug: ["query", "query-params"],
			logger: (message) => log.debug(message),
		});
	}
}

function migrationTarget(
	applicationName: string,
	connection: ConnectionInfo,
	module: MikroOrmModuleConfig,
	open: () => Promise<void>,
): MigrationTarget | undefined {
	if (module.database == null) return undefined;
	return {
		dataSource: connection.name,
		source: { connection, migrations: module.migrations ?? [], applicationName },
		migrator: module.database.migrator,
		open,
		diff: () => diff(applicationName, connection, module.entities),
	};
}

/** MikroORM's statements one per entry, without `create schema` or `drop schema`: schemas are the bootstrap's. */
function statements(sql: string): string[] {
	return sql
		.split(/;\n/)
		.map((statement) => statement.trim().replace(/;$/, ""))
		.filter(
			(statement) => statement.length > 0 && !/^(create|drop) schema\b/i.test(statement),
		);
}

/**
 * Bring the tables up to the mappings, safely: add what they need, never drop what they don't name.
 * MikroORM starts the update with `create schema`, which the app role may not run even when the
 * schema exists; the bootstrap creates schemas, so those statements are left out.
 */
async function synchronize(orm: MikroORM) {
	const sql = await orm.schema.getUpdateSchemaSQL({
		safe: true,
		dropTables: false,
		wrap: false,
	});
	for (const statement of statements(sql)) await orm.schema.execute(statement);
}

/**
 * MikroORM's schema diff, connected as the migrate role. That role sees only its own schema, so the
 * diff can't propose dropping another app's tables: MikroORM drops every table it sees and doesn't map.
 * The history table is skipped by name.
 */
async function diff(
	applicationName: string,
	connection: ConnectionInfo,
	entities: MikroOrmModuleConfig["entities"],
): Promise<SchemaDiff> {
	const orm = await MikroORM.init({
		host: connection.host,
		port: connection.port,
		dbName: connection.database,
		user: connection.migrateUsername || connection.username,
		password: connection.migrateUsername ? connection.migratePassword : connection.password,
		schema: connection.schema,
		entities,
		driverOptions: { application_name: applicationName },
		schemaGenerator: { skipTables: [HISTORY_TABLE] },
	});
	try {
		const { up, down } = await orm.schema.getUpdateSchemaMigrationSQL({ wrap: false });
		return { up: statements(up), down: statements(down) };
	} finally {
		await orm.close();
	}
}

function readinessCheck(name: string | symbol, orm: MikroORM): IReadinessCheck {
	return {
		name: `mikro-orm:${String(name)}`,
		async check() {
			const status = await orm.checkConnection();
			if ("reason" in status) throw new Error(status.reason, { cause: status.error });
		},
	};
}

/** Connect to the databases in the `database` config section with MikroORM. Requires `config(...)` on the builder. */
export function mikroOrm(
	config: MikroOrmModuleConfig[] | MikroOrmModuleConfig,
): BuilderPlugin {
	return (builder) => {
		let configured: ConfiguredMikroOrm = { sources: [], open: async () => {} };
		builder.registerPreBuildStep(async (configService, containerBuilder) => {
			const databaseConfig = await configService.get(DatabaseConfig);
			configured = await new MikroOrmModule().configure({
				applicationName: builder.applicationName,
				databaseConfig,
				moduleConfigurations: Array.isArray(config) ? config : [config],
				containerBuilder,
			});
		});
		// The container disposes only what it handed out. Resolving each instance here makes the
		// root container own it, as one of its first, so it closes last: after hosted services
		// and the services that use it.
		builder.registerPostBuildStep((container) => {
			for (const { name } of configured.sources) container.resolve(mikroOrmToken(name));
		});
		// Connecting, and what changes the database, wait for the app to start: building connects
		// nothing. The step is retried while the database is down, and holds back the hosted services.
		builder.registerStartStep(async (container) => {
			await configured.open();
			const log = scribe.logger("migrations");
			for (const { starting } of configured.sources) {
				await dataSources.start(starting, container, (line) => log.info(line));
			}
		}, "mikro-orm data sources");
	};
}
