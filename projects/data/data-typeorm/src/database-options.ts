import type { Constructable } from "@decohere/core/reflection";
import type { DataSource } from "typeorm";

export type ModuleConfig = {
	/** The unique identifier for the data source. Required when multiple data sources are configured. */
	name?: string | symbol;
	repositories?: Constructable[];
	entities: Constructable[];
	seed?: (dataSource: DataSource) => Promise<void>;
};
