import type { IContainer } from "@decohere/core/composition";
import type { ConnectionInfo } from "../connection-info.js";
import type { DataSourceBootstrap } from "../data-sources.js";
import type { Migration } from "./migration.js";

/** A data source's migrations, and where they run. */
export type MigrationSource = {
	connection: ConnectionInfo;
	migrations: readonly Migration[];
	/** Shown as the connection's application name on the server. */
	applicationName: string;
};

export type MigrateOptions = {
	container: IContainer;
	/** Stop after this migration. */
	to?: string;
	/** Say what would run, and run nothing. */
	dryRun?: boolean;
	log?: (line: string) => void;
};

export type RevertOptions = { container: IContainer; log?: (line: string) => void };

export type MigrationState =
	| { id: string; state: "applied"; appliedAt: Date }
	| { id: string; state: "pending" }
	/** In the history, but no migration in the code has its id: applied from another branch, or deleted. */
	| { id: string; state: "unknown"; appliedAt: Date };

/**
 * Runs Decohere migrations on one database: each database's package supplies one (`postgres` from
 * `@decohere/data-postgres`). It connects as the data source's migrate role, keeps the history in
 * a `decohere_migrations` table in the data source's schema, holds a lock so two runs never
 * overlap, and runs each migration in its own transaction.
 */
export interface Migrator {
	/** Apply what's pending, in id order. Returns the ids it applied (or would, with `dryRun`). */
	migrate(source: MigrationSource, options: MigrateOptions): Promise<string[]>;
	/** Undo the last applied migration. Returns its id, or `undefined` when none is applied. */
	revert(source: MigrationSource, options: RevertOptions): Promise<string | undefined>;
	/** Every migration in the code and the history, in id order. */
	status(source: MigrationSource): Promise<MigrationState[]>;
}

/**
 * What a database's package gives a provider: `postgres` from `@decohere/data-postgres`.
 * Pass it as the provider's `database` option.
 */
export type DatabaseSupport = {
	/** Creates the database, roles and schema when the config asks. */
	bootstrap: DataSourceBootstrap;
	migrator: Migrator;
};

/** The statements that take a data source's tables to its mappings, and back. */
export type SchemaDiff = { up: string[]; down: string[] };
