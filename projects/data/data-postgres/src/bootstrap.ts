import {
	assertBootstrapCredentials,
	assertDataSourceAuth,
	assertSynchronizeAllowed,
	type ConnectionInfo,
	DataConfigurationError,
	shouldBootstrapDatabase,
} from "@decohere/data";
import { PostgresServerManager } from "./server-manager.js";

export type BootstrapDataSourcesOptions = {
	/** Shown as `application_name` on the bootstrap connections. */
	applicationName: string;
	/** Defaults to `process.env.NODE_ENV`. Decides whether `auth: trust` and `synchronize` are allowed. */
	nodeEnv?: string;
};

/** What every data source on one server and database must agree on. */
const SHARED_FIELDS = ["auth", "adminUser", "migrateUsername"] as const;

/**
 * Check every data source's auth and `synchronize`, then create the databases, roles and schemas of those that
 * bootstrap. Data sources on the same server and database are bootstrapped once, one after the
 * other: in parallel they would race to create the same database and roles. Running it again
 * changes nothing.
 *
 * Pass it to a provider as `bootstrap: postgres.bootstrap`; runners and scripts that open their own
 * connection can call it directly.
 */
export async function bootstrapDataSources(
	dataSources: readonly ConnectionInfo[],
	options: BootstrapDataSourcesOptions,
): Promise<void> {
	const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
	for (const info of dataSources) {
		assertDataSourceAuth(info, nodeEnv);
		assertSynchronizeAllowed(info, nodeEnv);
	}

	const toBootstrap = dataSources.filter((info) => shouldBootstrapDatabase(info, nodeEnv));
	for (const info of toBootstrap) assertBootstrapCredentials(info);

	for (const group of byServerAndDatabase(toBootstrap)) {
		const [first] = group;
		await using server = new PostgresServerManager(options.applicationName, first);
		await server.connect();
		await server.initializeDatabase(first.database);
		for (const info of group) {
			await server.provisionRoles({
				database: info.database,
				appUsername: info.username,
				appPassword: info.password,
				migrateUsername: info.migrateUsername,
				migratePassword: info.migratePassword,
				allowAppDdl: info.synchronize === true,
				schema: info.schema,
			});
		}
	}
}

function byServerAndDatabase(dataSources: readonly ConnectionInfo[]): ConnectionInfo[][] {
	const groups = new Map<string, ConnectionInfo[]>();
	for (const info of dataSources) {
		const key = `${info.host}:${info.port}/${info.database}`;
		const group = groups.get(key);
		if (group == null) {
			groups.set(key, [info]);
			continue;
		}
		const [first] = group;
		for (const field of SHARED_FIELDS) {
			if (info[field] !== first[field]) {
				throw new DataConfigurationError(
					`Data sources "${first.name}" and "${info.name}" share database ${key} but set different ${field} (${JSON.stringify(first[field])} and ${JSON.stringify(info[field])})`,
				);
			}
		}
		group.push(info);
	}
	return [...groups.values()];
}
