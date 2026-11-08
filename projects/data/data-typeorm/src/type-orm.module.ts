import {
	type ConnectionInfo,
	type DatabaseConfig,
	dataSources,
	TrackingUnitOfWork,
	type Dialect,
	type Provider,
} from "@decohere/data";
import { type IReadinessCheck, ReadinessCheckToken } from "@decohere/core/hosting";
import type { ContainerBuilder } from "@decohere/crucible";
import { memoize } from "@decohere/core/caching";
import type { DataSource, Logger } from "typeorm";
import { bootstrapDataSources } from "@decohere/data/postgres";
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

		const modules = dataSources
			.resolve(databaseConfig, moduleConfigurations)
			.map(({ name, connectionInfo, module }) => ({
				name,
				connectionInfo,
				moduleConfig: module,
			}));
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
