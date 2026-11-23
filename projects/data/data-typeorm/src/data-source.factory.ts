import type { ConnectionInfo } from "@decohere/data";
import { DataSource, type DataSourceOptions, type Logger } from "typeorm";
import type { Entity } from "./database-options.js";
import { ProviderMap } from "./dialect-map.js";

export type ConnectionOptions = ConnectionInfo & {
	entities: Entity[];
	applicationName?: string;
};

/** Fields that are Decohere's, not TypeORM connection options. */
function omitProvisionFields(options: ConnectionOptions) {
	const {
		adminUser: _adminUser,
		adminPassword: _adminPassword,
		migrateUsername: _migrateUsername,
		migratePassword: _migratePassword,
		bootstrap: _bootstrap,
		auth: _auth,
		seed: _seed,
		// Decohere runs these when the app starts, not TypeORM when it connects.
		synchronize: _synchronize,
		migrateOnStart: _migrateOnStart,
		dialect: _dialect,
		name: _name,
		...rest
	} = options;
	return rest;
}

/**
 * A DataSource the container can close: TypeORM's has `destroy()` but no `Symbol.asyncDispose`,
 * so disposing the app's container used to leave its connections open.
 */
export class ManagedDataSource extends DataSource {
	public async [Symbol.asyncDispose]() {
		if (this.isInitialized) {
			await this.destroy();
		}
	}
}

export class DataSourceFactory {
	/** @param inCode TypeORM options the app gave in code, spread over those from config. */
	public static create(
		options: ConnectionOptions,
		logger: Logger,
		inCode: Partial<DataSourceOptions> = {},
	): DataSource {
		const { applicationName } = options;
		const { provider } = options;
		const type = ProviderMap[provider];

		return new ManagedDataSource({
			type,
			logger,
			applicationName,
			...omitProvisionFields(options),
			...inCode,
		} as DataSourceOptions);
	}
}
