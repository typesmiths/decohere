import { Builder } from "@decohere/http";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import { extension } from "@decohere/core/extensibility";
import type { Constructable } from "@decohere/core/reflection";
import { ConfigurationService } from "./configuration.service.js";
import type { ConfigurationDataSource } from "./configuration-data-source.js";
import { ConfigurationDataSourceKey } from "./const.js";

export type ConfigurationOptions = {
	configurationService?: Constructable<IConfigurationService>;
	dataSources?: Constructable<ConfigurationDataSource>[];
};

declare module "@decohere/http" {
	interface Builder {
		withConfiguration(...dataSources: Constructable<ConfigurationDataSource>[]): Builder;
	}
}

export class BuilderExtensions {
	@extension(Builder)
	public static withConfiguration(
		builder: Builder,
		...dataSourceArgs: Constructable<ConfigurationDataSource>[]
	) {
		const dataSources: Constructable<ConfigurationDataSource>[] = dataSourceArgs ?? [];
		builder.withServices((builder) => {
			builder.registerSingleton(ConfigurationServiceToken, ConfigurationService);
			for (const dataSource of dataSources) {
				builder.registerSingleton(ConfigurationDataSourceKey, dataSource);
			}
		});

		return builder;
	}
}
