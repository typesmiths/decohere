import { ConfigurationServiceToken } from "@decohere/core/configuration";
import type { BuilderPlugin } from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import { ConfigurationService } from "./configuration.service.js";
import type { ConfigurationDataSource } from "./configuration-data-source.js";
import { ConfigurationDataSourceKey } from "./const.js";

/**
 * Read configuration from the given sources, in order: a later source overrides an earlier one,
 * key by key. For example `config(YamlDataSource, EnvDataSource)`.
 */
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
		// Loads every source, so a bad one stops the build, not the first read of its section.
		builder.registerPreBuildStep(async (configuration) => {
			await configuration.get("");
		});
	};
}

/**
 * Check this section when the app is built, so bad config stops it at boot, and make it injectable
 * by its class. Requires `config(...)` on the builder.
 */
export function configSection(type: Constructable): BuilderPlugin {
	return (builder) => {
		builder.registerPreBuildStep(async (configuration, containerBuilder) => {
			containerBuilder.registerSingleton(type, await configuration.get(type));
		});
	};
}
