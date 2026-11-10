import type { Migrator, MigrationSource, SchemaDiff } from "./migrator.js";

/** Where a provider registers each data source's {@link MigrationTarget}: the db commands resolve them all. */
export const MigrationTargetToken = Symbol("MigrationTarget");

/** One data source, as the db commands see it. A provider registers one for each data source it opens. */
export type MigrationTarget = {
	/** The data source's name in the `database` config. */
	dataSource: string;
	source: MigrationSource;
	migrator: Migrator;
	/**
	 * The statements that take the database's tables to the provider's mappings, from the
	 * provider's own schema diff, connected as the migrate role so it sees only its own schema.
	 * Leaves the history table alone.
	 */
	diff(): Promise<SchemaDiff>;
};
