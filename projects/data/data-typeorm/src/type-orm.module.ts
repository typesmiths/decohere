import {
	type ConnectionInfo,
	type DatabaseConfig,
	DataConfigurationError,
	DEFAULT_DATA_SOURCE,
	TrackingUnitOfWork,
	type Dialect,
	type Provider,
} from "@decohere/data";
import { type IReadinessCheck, ReadinessCheckToken } from "@decohere/core/hosting";
import type { ContainerBuilder } from "@decohere/crucible";
import { memoize } from "@decohere/core/caching";
import type { DataSource, Logger } from "typeorm";
import { bootstrapDataSources } from "./bootstrap.js";
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

export class TypeOrmModule {
	/** Registers and opens a DataSource per module. Returns the names it registered them under. */
	public async configure(options: TypeOrmModuleOptions): Promise<(string | symbol)[]> {
		const { moduleConfigurations, databaseConfig, containerBuilder, applicationName } =
			options;

		if (databaseConfig.dataSources.length === 0) {
			throw new DataConfigurationError("No datasources detected in config");
		}

		const modules = this.resolveDataSources(databaseConfig, moduleConfigurations);
		// Once, before any DataSource opens: modules sharing a database must not race to create it.
		await bootstrapDataSources(
			modules.map((m) => m.connectionInfo),
			{ applicationName },
		);

		return await Promise.all(
			modules.map(async ({ name, connectionInfo, moduleConfig }) => {
				await this.init(applicationName, name, connectionInfo, moduleConfig, containerBuilder);
				return name;
			}),
		);
	}

	private resolveDataSources(
		databaseConfig: DatabaseConfig,
		moduleConfigurations: ModuleConfig[],
	): { name: string | symbol; connectionInfo: ConnectionInfo; moduleConfig: ModuleConfig }[] {
		if (databaseConfig.dataSources.length === 1 && moduleConfigurations.length === 1) {
			const moduleConfig = moduleConfigurations.at(0);
			return [
				{
					name: moduleConfig.name ?? DEFAULT_DATA_SOURCE,
					connectionInfo: databaseConfig.dataSources.at(0),
					moduleConfig,
				},
			];
		}

		return moduleConfigurations.map((moduleConfig) => {
			const { name } = moduleConfig;
			if (name == null) {
				throw new DataConfigurationError(
					`Name is required if there is more than one datasource`,
				);
			}

			const connectionInfo = databaseConfig.dataSources.find((ds) => ds.name === name);
			if (connectionInfo == null) {
				throw new DataConfigurationError(`Cannot find connection info for ${name.toString()}`);
			}

			return { name, connectionInfo, moduleConfig };
		});
	}

	private async init(
		applicationName: string,
		name: string | symbol,
		connectionInfo: ConnectionInfo,
		moduleConfig: ModuleConfig,
		builder: ContainerBuilder,
	) {
		const logger = this.getLoggerFor(name, connectionInfo.dialect);
		const dataSource = await this.configureTypeOrmDataSource(
			applicationName,
			name,
			moduleConfig,
			connectionInfo,
			builder,
			logger,
		);
		if (connectionInfo.seed) {
			await moduleConfig.seed?.(dataSource);
		}
	}

	private async configureTypeOrmDataSource(
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
