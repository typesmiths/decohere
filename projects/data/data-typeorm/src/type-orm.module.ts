import {
	type ConnectionInfo,
	type DatabaseConfig,
	DataConfigurationError,
	dataSources,
	type Dialect,
	type MigrationTarget,
	MigrationTargetToken,
	type Provider,
	type SchemaDiff,
	type StartingDataSource,
	TrackingUnitOfWork,
} from "@decohere/data";
import { type IReadinessCheck, ReadinessCheckToken } from "@decohere/core/hosting";
import type { ContainerBuilder } from "@decohere/crucible";
import { memoize } from "@decohere/core/caching";
import type { DataSource, Logger } from "typeorm";
import { DataSourceFactory } from "./data-source.factory.js";
import type { ModuleConfig } from "./database-options.js";
import { typeOrmDataSourceToken } from "./inject-data-source.js";
import { TypeOrmScribeLogger } from "./typeorm-scribe.logger.js";
import { TypeOrmRowStore } from "./type-orm.row-store.js";

export type TypeOrmModuleOptions = {
	applicationName: string;
	databaseConfig: DatabaseConfig;
	moduleConfigurations: ModuleConfig[];
	containerBuilder: ContainerBuilder;
};

/** A data source the module opened: its container key, and what the app does with it on start. */
export type OpenedDataSource = { name: string | symbol; starting: StartingDataSource };

export class TypeOrmModule {
	/** Registers and opens a DataSource per module. */
	public async configure(options: TypeOrmModuleOptions): Promise<OpenedDataSource[]> {
		const { moduleConfigurations, databaseConfig, containerBuilder, applicationName } =
			options;

		const modules = dataSources.resolve(databaseConfig, moduleConfigurations);
		// Once, before any DataSource opens: modules sharing a database must not race to create it.
		await dataSources.prepare(
			modules.map((m) => m.connectionInfo),
			{
				applicationName,
				bootstrap: moduleConfigurations.find((m) => m.database)?.database?.bootstrap,
			},
		);

		return await Promise.all(
			modules.map(async ({ name, connectionInfo, module }) => {
				const logger = this.getLoggerFor(name, connectionInfo.dialect);
				const dataSource = await this.open(
					applicationName,
					name,
					module,
					connectionInfo,
					containerBuilder,
					logger,
				);
				const migrations = migrationTarget(applicationName, connectionInfo, module, logger);
				if (migrations != null) {
					containerBuilder.registerSingleton(MigrationTargetToken, migrations);
				}
				return {
					name,
					starting: {
						connection: connectionInfo,
						migrations,
						synchronize: () => dataSource.synchronize(),
						seed: async () => module.seed?.(dataSource),
					},
				};
			}),
		);
	}

	private async open(
		applicationName: string,
		name: string | symbol,
		moduleConfig: ModuleConfig,
		connectionInfo: ConnectionInfo,
		builder: ContainerBuilder,
		logger: Logger,
	) {
		const { entities, repositories, outbox } = moduleConfig;
		const dataSource = DataSourceFactory.create(
			{
				entities,
				applicationName,
				...connectionInfo,
			},
			logger,
		);

		await dataSource.initialize();
		const unitOfWork = () =>
			new TrackingUnitOfWork(new TypeOrmRowStore(dataSource), { outbox });
		builder.registerRequestScoped(name, unitOfWork);
		builder.registerSingleton(typeOrmDataSourceToken(name), dataSource);
		builder.registerSingleton(
			ReadinessCheckToken,
			createTypeOrmReadinessCheck(name, dataSource),
		);

		for (const repo of repositories ?? []) {
			builder.registerRequestScoped(repo);
		}

		return dataSource;
	}

	@memoize()
	private getLoggerFor(name: string | symbol, dialectOrProvider: Dialect | Provider) {
		return new TypeOrmScribeLogger(name.toString(), dialectOrProvider);
	}
}

function migrationTarget(
	applicationName: string,
	connection: ConnectionInfo,
	module: ModuleConfig,
	logger: Logger,
): MigrationTarget | undefined {
	if (module.database == null) return undefined;
	return {
		dataSource: connection.name,
		source: { connection, migrations: module.migrations ?? [], applicationName },
		migrator: module.database.migrator,
		diff: () => diff(applicationName, connection, module, logger),
	};
}

/**
 * TypeORM's schema diff, connected as the migrate role, so it sees only its own schema. TypeORM
 * never proposes dropping a table it doesn't map, so the history table is safe.
 */
async function diff(
	applicationName: string,
	connection: ConnectionInfo,
	module: ModuleConfig,
	logger: Logger,
): Promise<SchemaDiff> {
	const dataSource = DataSourceFactory.create(
		{
			...connection,
			username: connection.migrateUsername || connection.username,
			password: connection.migrateUsername ? connection.migratePassword : connection.password,
			entities: module.entities,
			applicationName,
		},
		logger,
	);
	await dataSource.initialize();
	try {
		const log = await dataSource.driver.createSchemaBuilder().log();
		return {
			up: log.upQueries.map(statement),
			down: log.downQueries.reverse().map(statement),
		};
	} finally {
		await dataSource.destroy();
	}
}

function createTypeOrmReadinessCheck(
	name: string | symbol,
	dataSource: DataSource,
): IReadinessCheck {
	return {
		name: `typeorm:${String(name)}`,
		async check() {
			await dataSource.query("SELECT 1");
		},
	};
}

/** A migration holds plain SQL; TypeORM passes values separately only for its own metadata table (views). */
function statement(query: { query: string; parameters?: unknown[] }): string {
	if (query.parameters != null && query.parameters.length > 0) {
		throw new DataConfigurationError(
			`TypeORM's schema diff has a statement with parameters, which a migration can't hold: ${query.query}`,
		);
	}
	return query.query;
}
