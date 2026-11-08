import type { Constructable } from "@decohere/core/reflection";
import type { DatabaseSupport, Migration, OutboxMapper } from "@decohere/data";
import type { DataSource } from "typeorm";

export type ModuleConfig = {
	/** The unique identifier for the data source. Required when multiple data sources are configured. */
	name?: string | symbol;
	repositories?: Constructable[];
	entities: Constructable[];
	/**
	 * The database's package: `postgres` from `@decohere/data-postgres`. It creates the database,
	 * roles and schema when the config asks, and runs migrations.
	 */
	database?: DatabaseSupport;
	/** The data source's migrations: `migrations` from its migrations folder's `index.ts`. */
	migrations?: readonly Migration[];
	/** Writes the events aggregates raise to an outbox entity, in the same commit. */
	outbox?: OutboxMapper;
	/** Runs when the app starts, after migrations, when the data source's `seed` is on. */
	seed?: (dataSource: DataSource) => Promise<void>;
};
