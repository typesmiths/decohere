import type { ResolveRequest } from "@decohere/core/composition";
import type { Constructable } from "@decohere/core/reflection";
import type {
	DatabaseSupport,
	Migration,
	OutboxMapper,
	TransactionSettingsSource,
} from "@decohere/data";
import type { DataSource, DataSourceOptions, EntitySchema } from "typeorm";

/**
 * What TypeORM maps: a class, or an `EntitySchema` mapping a class that imports no ORM. Not a file
 * glob, which TypeORM would load on its own, outside flux.
 */
export type Entity = Constructable | EntitySchema;

export type ModuleConfig = {
	/** The unique identifier for the data source. Required when multiple data sources are configured. */
	name?: string | symbol;
	repositories?: Constructable[];
	entities: Entity[];
	/**
	 * The database's package: `postgres` from `@decohere/data-postgres`. It creates the database,
	 * roles and schema when the config asks, and runs migrations.
	 */
	database?: DatabaseSupport;
	/** The data source's migrations: `migrations` from its migrations folder's `index.ts`. */
	migrations?: readonly Migration[];
	/** Writes the events aggregates raise to an outbox entity, in the same commit. */
	outbox?: OutboxMapper;
	/**
	 * The app's service that gives the settings each transaction begins with, for a row-level
	 * security policy, such as the request's tenant. With one, every read runs in a transaction.
	 */
	settings?: ResolveRequest<TransactionSettingsSource>;
	/**
	 * TypeORM options given in code, for what config can't hold because it isn't plain data, such as
	 * a `driver` (one pg pool shared by every data source). Spread over the options config gives, so
	 * code wins only for what it sets. Used for the app's data source, not `db generate`'s.
	 */
	dataSourceOptions?: Partial<DataSourceOptions>;
	/** Runs when the app starts, after migrations, when the data source's `seed` is on. */
	seed?: (dataSource: DataSource) => Promise<void>;
};
