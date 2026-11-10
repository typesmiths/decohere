// Everything Postgres-only in Decohere's data layer: creating a data source's database,
// least-privilege roles and schema at startup, and running its migrations. A provider gets both
// when it is passed `database: postgres`.
import type { DatabaseSupport } from "@decohere/data";
import { bootstrapDataSources } from "./bootstrap.js";
import { postgresMigrator } from "./migrator.js";

export * from "./bootstrap.js";
export * from "./migrator.js";

export const postgres: DatabaseSupport = {
	bootstrap: bootstrapDataSources,
	migrator: postgresMigrator,
};
