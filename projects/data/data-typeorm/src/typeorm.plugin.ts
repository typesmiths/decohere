import type { BuilderPlugin } from "@decohere/core/hosting";
import { DatabaseConfig, dataSources } from "@decohere/data";
import { scribe } from "@decohere/scribe";
import type { ModuleConfig } from "./database-options.js";
import { typeOrmDataSourceToken } from "./inject-data-source.js";
import { type OpenedDataSource, TypeOrmModule } from "./type-orm.module.js";

/** Connect to the databases in the `database` config section. Requires `config(...)` on the builder. */
export function typeOrm(config: ModuleConfig[] | ModuleConfig): BuilderPlugin {
	return (builder) => {
		const opened: OpenedDataSource[] = [];
		builder.registerPreBuildStep(async (configService, containerBuilder) => {
			const databaseConfig = await configService.get(DatabaseConfig);
			const module = new TypeOrmModule();
			const moduleConfigurations = Array.isArray(config) ? config : [config];
			const applicationName = builder.applicationName;
			opened.push(
				...(await module.configure({
					applicationName,
					databaseConfig,
					moduleConfigurations,
					containerBuilder,
				})),
			);
		});
		// The container disposes only what it has handed out, and nothing may ever ask for a
		// DataSource by its token. Resolving each here makes the root container own it, as one of
		// its first instances, so it is closed last: after hosted services and other services
		// that use it.
		builder.registerPostBuildStep((container) => {
			for (const { name } of opened) container.resolve(typeOrmDataSourceToken(name));
		});
		// Migrations, synchronize and seed change the database, so they wait for the app to start.
		builder.registerStartStep(async (container) => {
			const log = scribe.logger("migrations");
			for (const { starting } of opened) {
				await dataSources.start(starting, container, (line) => log.info(line));
			}
		});
	};
}
