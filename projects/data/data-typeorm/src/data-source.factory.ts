import type { ConnectionInfo } from "@decohere/data";
import type { Constructable } from "@decohere/core/reflection";
import { DataSource, type Logger } from "typeorm";
import { ProviderMap } from "./dialect-map.js";

export type ConnectionOptions = ConnectionInfo & {
	entities: Constructable[];
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
		if (this.isInitialized) await this.destroy();
	}
}

export class DataSourceFactory {
	public static create(options: ConnectionOptions, logger: Logger): DataSource {
		const { applicationName } = options;
		const { provider } = options;
		const type = ProviderMap[provider];

		return new ManagedDataSource({
			type,
			logger,
			applicationName,
			...omitProvisionFields(options),
		});
	}
}
