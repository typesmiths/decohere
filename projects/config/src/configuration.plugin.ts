import { ConfigurationServiceToken } from "@decohere/core/configuration";
import type { BuilderPlugin } from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import { ConfigurationService } from "./configuration.service.js";
import type { ConfigurationDataSource } from "./configuration-data-source.js";
import { ConfigurationDataSourceKey } from "./const.js";

/** Read configuration from the given sources, such as `YamlDataSource`. */
export function config(
	...dataSources: Constructable<ConfigurationDataSource>[]
): BuilderPlugin {
	return (builder) => {
		builder.withServices((containerBuilder) => {
			containerBuilder.registerSingleton(ConfigurationServiceToken, ConfigurationService);
			for (const dataSource of dataSources) {
				containerBuilder.registerSingleton(ConfigurationDataSourceKey, dataSource);
			}
		});
	};
}
