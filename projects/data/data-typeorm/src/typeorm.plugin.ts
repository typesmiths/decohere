import type { BuilderPlugin } from "@decohere/core/hosting";
import { DatabaseConfig, dataSources } from "@decohere/data";
import { scribe } from "@decohere/scribe";
import type { ModuleConfig } from "./database-options.js";
import { typeOrmDataSourceToken } from "./inject-data-source.js";
import { type ConfiguredDataSources, TypeOrmModule } from "./type-orm.module.js";

/** Connect to the databases in the `database` config section. Requires `config(...)` on the builder. */
export function typeOrm(config: ModuleConfig[] | ModuleConfig): BuilderPlugin {
	return (builder) => {
		let configured: ConfiguredDataSources = { sources: [], open: async () => {} };
		builder.registerPreBuildStep(async (configService, containerBuilder) => {
			const databaseConfig = await configService.get(DatabaseConfig);
			const module = new TypeOrmModule();
			const moduleConfigurations = Array.isArray(config) ? config : [config];
			const applicationName = builder.applicationName;
			configured = await module.configure({
				applicationName,
				databaseConfig,
				moduleConfigurations,
				containerBuilder,
			});
		});
		// The container disposes only what it has handed out, and nothing may ever ask for a
		// DataSource by its token. Resolving each here makes the root container own it, as one of
		// its first instances, so it is closed last: after hosted services and other services
		// that use it.
		builder.registerPostBuildStep((container) => {
			for (const { name } of configured.sources) {
				container.resolve(typeOrmDataSourceToken(name));
			}
		});
		// Connecting, and what changes the database, wait for the app to start: building connects
		// nothing. The step is retried while the database is down, and holds back the hosted services.
		builder.registerStartStep(async (container) => {
			await configured.open();
			const log = scribe.logger("migrations");
			for (const { starting } of configured.sources) {
				await dataSources.start(starting, container, (line) => log.info(line));
			}
		}, "typeorm data sources");
	};
}
