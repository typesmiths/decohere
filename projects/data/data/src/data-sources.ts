import type { IContainer } from "@decohere/core/composition";
import type { ConnectionInfo } from "./connection-info.js";
import type { MigrationTarget } from "./migrations/migration-target.js";
import {
	assertDataSourceAuth,
	assertMigrateOnStartAllowed,
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
 * a schema. Each database's package supplies one, as part of the {@link DatabaseSupport} passed to
 * the provider as `database` (`postgres` from `@decohere/data-postgres`).
 */
export type DataSourceBootstrap = (
	dataSources: readonly ConnectionInfo[],
	options: { applicationName: string; nodeEnv?: string },
) => Promise<void>;

export type CheckOptions = {
	/** The bootstrap the provider was given, if any. */
	bootstrap?: DataSourceBootstrap;
	/** Defaults to `process.env.NODE_ENV`. */
	nodeEnv?: string;
};

export type OpenOptions = CheckOptions & { applicationName: string };

/**
 * What every provider checks when the app is built, before anything connects: each data source's
 * `auth`, `synchronize` and `migrateOnStart` for the environment. A data source that asks to be
 * set up (`bootstrap: true`, or an admin user in development) with no bootstrap given is an
 * error now, rather than a login failure later. A mistake here won't fix itself, so it fails the
 * build instead of being retried at start.
 */
function check(sources: readonly ConnectionInfo[], options: CheckOptions = {}) {
	const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
	for (const info of sources) {
		assertDataSourceAuth(info, nodeEnv);
		assertSynchronizeAllowed(info, nodeEnv);
		assertMigrateOnStartAllowed(info, nodeEnv);
	}
	if (options.bootstrap) {
		return;
	}
	const asking = sources.filter((info) => shouldBootstrapDatabase(info, nodeEnv));
	if (asking.length === 0) {
		return;
	}
	const names = asking.map((info) => `"${info.name}"`).join(", ");
	throw new DataConfigurationError(
		`Data source ${names} asks to be set up at startup (bootstrap), but the provider was given no bootstrap. Install the package for its database and pass it to the provider: database: postgres, from @decohere/data-postgres. Or set bootstrap: false.`,
	);
}

/** A data source, as {@link open} and {@link start} see it: the provider supplies how to connect, synchronize and seed. */
export type StartingDataSource = {
	connection: ConnectionInfo;
	/** Present when the provider was given a `database` with a migrator. */
	migrations?: MigrationTarget;
	/** Connect, if not connected yet. Throws while the database can't be reached. */
	connect(): Promise<void>;
	synchronize(): Promise<void>;
	seed(): Promise<void>;
};

/**
 * Bring a provider's data sources up: run the bootstrap it was given (once for all of them, so data
 * sources sharing a database don't race to create it), then connect each. The app's start step
 * does this, and is retried while the database is down; the db commands do it before they run.
 * Safe to run again: the bootstrap creates only what is missing, and a connected data source stays
 * as it is.
 */
async function open(sources: readonly StartingDataSource[], options: OpenOptions) {
	const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
	await options.bootstrap?.(
		sources.map((source) => source.connection),
		{ applicationName: options.applicationName, nodeEnv },
	);
	for (const source of sources) {
		await source.connect();
	}
}

/**
 * What every provider does for a data source when the app starts, once {@link open} has connected
 * it (a start step, so an app built by a tool or a test changes nothing): apply pending migrations when `migrateOnStart` is on, bring the
 * tables to the mappings when `synchronize` is on, then seed when `seed` is on.
 */
async function start(
	source: StartingDataSource,
	container: IContainer,
	log?: (line: string) => void,
) {
	const { connection } = source;
	// As the policy counts it: anything but false or absent is on.
	const migrateOnStart: unknown = connection.migrateOnStart;
	if (migrateOnStart != null && migrateOnStart !== false) {
		const target = source.migrations;
		if (target == null) {
			throw new DataConfigurationError(
				`Data source "${connection.name}" sets migrateOnStart, but the provider has no migrator. Pass it the database's package: database: postgres, from @decohere/data-postgres.`,
			);
		}
		await target.migrator.migrate(target.source, {
			container,
			log,
		});
	}
	if (connection.synchronize) {
		await source.synchronize();
	}
	if (connection.seed) {
		await source.seed();
	}
}

export const dataSources = { check, open, resolve, start };
