import type { Constructable } from "@decohere/core/reflection";
import type { OutboxMapper } from "@decohere/data";
import type { DataSource } from "typeorm";

export type ModuleConfig = {
	/** The unique identifier for the data source. Required when multiple data sources are configured. */
	name?: string | symbol;
	repositories?: Constructable[];
	entities: Constructable[];
	/** Writes the events aggregates raise to an outbox entity, in the same commit. */
	outbox?: OutboxMapper;
	seed?: (dataSource: DataSource) => Promise<void>;
};
