import type { ConnectionInfo } from "./connection-info.js";
import type { DatabaseConfig } from "./database.config.js";
import { DataConfigurationError } from "./error.js";
import { DEFAULT_DATA_SOURCE } from "./inject-unit-of-work.js";

/** What a provider plugin is given per data source: at least the name it is configured under. */
export type DataSourceModule = { name?: string | symbol };

export type ResolvedDataSource<M extends DataSourceModule> = {
	/** The unit of work's container key: the module's name, or {@link DEFAULT_DATA_SOURCE}. */
	name: string | symbol;
	connectionInfo: ConnectionInfo;
	module: M;
};

/**
 * Pair each module a provider plugin was given with its data source in the `database` config.
 * One data source and one module need no names; otherwise each module names its data source.
 */
function resolve<M extends DataSourceModule>(
	config: DatabaseConfig,
	modules: M[],
): ResolvedDataSource<M>[] {
	if (config.dataSources.length === 0) {
		throw new DataConfigurationError("No datasources detected in config");
	}
	if (config.dataSources.length === 1 && modules.length === 1) {
		const [module] = modules;
		return [
			{
				name: module.name ?? DEFAULT_DATA_SOURCE,
				connectionInfo: config.dataSources[0],
				module,
			},
		];
	}
	return modules.map((module) => {
		const { name } = module;
		if (name == null) {
			throw new DataConfigurationError(
				"Name is required if there is more than one datasource",
			);
		}
		const connectionInfo = config.dataSources.find((ds) => ds.name === name);
		if (connectionInfo == null) {
			throw new DataConfigurationError(`Cannot find connection info for ${name.toString()}`);
		}
		return { name, connectionInfo, module };
	});
}

export const dataSources = { resolve };
