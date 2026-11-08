import type { Constructable } from "@decohere/core/reflection";
import type { DataSourceBootstrap, OutboxMapper } from "@decohere/data";
import type { DataSource } from "typeorm";

export type ModuleConfig = {
	/** The unique identifier for the data source. Required when multiple data sources are configured. */
	name?: string | symbol;
	repositories?: Constructable[];
	entities: Constructable[];
	/** Creates the database, roles and schema when the config asks: `postgres.bootstrap` from `@decohere/data-postgres`. */
	bootstrap?: DataSourceBootstrap;
	/** Writes the events aggregates raise to an outbox entity, in the same commit. */
	outbox?: OutboxMapper;
	seed?: (dataSource: DataSource) => Promise<void>;
};
