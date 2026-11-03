import { DatabaseConfig } from "@decohere/data";
import { Builder } from "@decohere/http";
import { extension } from "@decohere/core/extensibility";
import type { Logger } from "typeorm";
import type { ModuleConfig } from "./database-options.js";
import { typeOrmDataSourceToken } from "./inject-data-source.js";
import { TypeOrmModule } from "./type-orm.module.js";

declare module "@decohere/http" {
	interface Builder {
		withTypeOrm(options?: ModuleConfig[] | ModuleConfig, logger?: Logger): Builder;
	}
}

export class BuilderExtensions {
	@extension(Builder)
	public static withTypeOrm(builder: Builder, config: ModuleConfig[] | ModuleConfig) {
		const names: (string | symbol)[] = [];
		builder.registerPreBuildStep(async (configService, containerBuilder) => {
			const databaseConfig = await configService.get(DatabaseConfig);
			const module = new TypeOrmModule();
			const moduleConfigurations = Array.isArray(config) ? config : [config];
			const applicationName = builder.applicationName;
			names.push(
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
			for (const name of names) container.resolve(typeOrmDataSourceToken(name));
		});
		return builder;
	}
}
