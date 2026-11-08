import type { BuilderPlugin } from "@decohere/core/hosting";
import { type IReadinessCheck, ReadinessCheckToken } from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import type { ContainerBuilder } from "@decohere/crucible";
import {
	type ConnectionInfo,
	DatabaseConfig,
	DataConfigurationError,
	dataSources,
	type OutboxMapper,
} from "@decohere/data";
import { bootstrapDataSources } from "@decohere/data/postgres";
import { scribe } from "@decohere/scribe";
import { type Options, MikroORM } from "@mikro-orm/postgresql";
import { mikroOrmToken } from "./inject-mikro-orm.js";
import { MikroOrmUnitOfWork } from "./mikro-orm.unit-of-work.js";

export type MikroOrmModuleConfig = {
	/** The data source's name in the `database` config. Required when there is more than one. */
	name?: string | symbol;
	/** The mappings: `defineEntity({ class, … })` results or `EntitySchema`s. */
	entities: NonNullable<Options["entities"]>;
	repositories?: Constructable[];
	/** Writes the events aggregates raise to an outbox entity, in the same commit. */
	outbox?: OutboxMapper;
	/** Runs after connecting when the data source's `seed` is on. */
	seed?: (orm: MikroORM) => Promise<void>;
};

export type MikroOrmModuleOptions = {
	applicationName: string;
	databaseConfig: DatabaseConfig;
	moduleConfigurations: MikroOrmModuleConfig[];
	containerBuilder: ContainerBuilder;
};

export class MikroOrmModule {
	/** Bootstraps and opens a MikroORM instance per data source. Returns the names it registered them under. */
	public async configure(options: MikroOrmModuleOptions): Promise<(string | symbol)[]> {
		const { applicationName, databaseConfig, moduleConfigurations, containerBuilder } =
			options;
		const resolved = dataSources.resolve(databaseConfig, moduleConfigurations);
		// Once, before any instance connects: data sources sharing a database must not race to create it.
		await bootstrapDataSources(
			resolved.map((r) => r.connectionInfo),
			{ applicationName },
		);
		return Promise.all(
			resolved.map(async ({ name, connectionInfo, module }) => {
				const orm = await this.open(applicationName, name, connectionInfo, module);
				containerBuilder.registerSingleton(mikroOrmToken(name), orm);
				containerBuilder.registerRequestScoped(
					name,
					() => new MikroOrmUnitOfWork(orm.em, { outbox: module.outbox }),
				);
				containerBuilder.registerSingleton(ReadinessCheckToken, readinessCheck(name, orm));
				for (const repository of module.repositories ?? []) {
					containerBuilder.registerRequestScoped(repository);
				}
				return name;
			}),
		);
	}

	private async open(
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
		const orm = await MikroORM.init({
			host: connection.host,
			port: connection.port,
			dbName: connection.database,
			user: connection.username,
			password: connection.password,
			schema: connection.schema,
			entities: module.entities,
			driverOptions: { application_name: applicationName },
			debug: ["query", "query-params"],
			logger: (message) => log.debug(message),
		});
		if (connection.synchronize) await synchronize(orm);
		if (connection.seed) await module.seed?.(orm);
		return orm;
	}
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
	const statements = sql
		.split(/;\n/)
		.map((statement) => statement.trim().replace(/;$/, ""))
		.filter((statement) => statement.length > 0 && !/^create schema\b/i.test(statement));
	for (const statement of statements) await orm.schema.execute(statement);
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
		const names: (string | symbol)[] = [];
		builder.registerPreBuildStep(async (configService, containerBuilder) => {
			const databaseConfig = await configService.get(DatabaseConfig);
			names.push(
				...(await new MikroOrmModule().configure({
					applicationName: builder.applicationName,
					databaseConfig,
					moduleConfigurations: Array.isArray(config) ? config : [config],
					containerBuilder,
				})),
			);
		});
		// The container disposes only what it handed out. Resolving each instance here makes the
		// root container own it, as one of its first, so it closes last: after hosted services
		// and the services that use it.
		builder.registerPostBuildStep((container) => {
			for (const name of names) container.resolve(mikroOrmToken(name));
		});
	};
}
