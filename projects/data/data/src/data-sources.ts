import type { ConnectionInfo } from "./connection-info.js";
import {
	assertDataSourceAuth,
	assertSynchronizeAllowed,
	shouldBootstrapDatabase,
} from "./data-source-policy.js";
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

/**
 * Creates what data sources need on their server before a provider connects: a database, roles,
 * a schema. Each database has its own package that supplies one (`postgres.bootstrap` from
 * `@decohere/data-postgres`), passed to the provider as `bootstrap`.
 */
export type DataSourceBootstrap = (
	dataSources: readonly ConnectionInfo[],
	options: { applicationName: string; nodeEnv?: string },
) => Promise<void>;

export type PrepareOptions = {
	applicationName: string;
	bootstrap?: DataSourceBootstrap;
	/** Defaults to `process.env.NODE_ENV`. */
	nodeEnv?: string;
};

/**
 * What every provider runs before it connects. It checks each data source's `auth` and
 * `synchronize` for the environment, then runs the bootstrap it was given. A data source that
 * asks to be set up (`bootstrap: true`, or an admin user in development) with no bootstrap given
 * is an error, rather than a login failure later.
 */
async function prepare(sources: readonly ConnectionInfo[], options: PrepareOptions) {
	const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
	for (const info of sources) {
		assertDataSourceAuth(info, nodeEnv);
		assertSynchronizeAllowed(info, nodeEnv);
	}
	if (options.bootstrap) {
		await options.bootstrap(sources, { applicationName: options.applicationName, nodeEnv });
		return;
	}
	const asking = sources.filter((info) => shouldBootstrapDatabase(info, nodeEnv));
	if (asking.length === 0) return;
	const names = asking.map((info) => `"${info.name}"`).join(", ");
	throw new DataConfigurationError(
		`Data source ${names} asks to be set up at startup (bootstrap), but the provider was given no bootstrap. Install the package for its database and pass it: bootstrap: postgres.bootstrap, from @decohere/data-postgres. Or set bootstrap: false.`,
	);
}

export const dataSources = { prepare, resolve };
