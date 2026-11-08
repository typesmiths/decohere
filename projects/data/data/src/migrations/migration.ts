import type { IContainer } from "@decohere/core/composition";

export type MigrationRow = Record<string, unknown>;

/** What a migration's `up` and `down` get. Everything runs in the migration's one transaction. */
export type MigrationContext<C = IContainer> = {
	/** Run one statement as the data source's migrate role, in its schema. Returns the rows. */
	sql<R extends MigrationRow = MigrationRow>(text: string, params?: unknown[]): Promise<R[]>;
	/**
	 * The app's container, so a data migration can use the app's services: a policy, a clock, a
	 * mapper. What they write through their own connections is outside this migration's transaction.
	 */
	container: C;
	/**
	 * Run `select` again and again, with the batch size as `$1`, handing each page of rows to `each`,
	 * until it returns none. `each` must change the rows so `select` stops finding them, or it never ends.
	 */
	batch<R extends MigrationRow = MigrationRow>(
		select: string,
		size: number,
		each: (rows: R[]) => Promise<void>,
	): Promise<void>;
};

/**
 * One change to a data source: its schema, its data, or both. Write it with {@link defineMigration}
 * in the data source's migrations folder; the db commands list it in that folder's `index.ts`.
 */
export type Migration<C = IContainer> = {
	/** Sortable and unique: `YYYYMMDD-HHMMSS-name`, which is also its file name. Applied in id order. */
	id: string;
	up(context: MigrationContext<C>): Promise<void>;
	/** How to undo `up`, for `db revert`. Leave it out when the change can't be undone. */
	down?(context: MigrationContext<C>): Promise<void>;
};

/**
 * Declare a migration. `C` is the container's type, when the app has its own.
 *
 * ```ts
 * export default defineMigration({
 * 	id: "20261110-093000-backfill-expiry",
 * 	async up({ sql, batch }) {
 * 		await batch(`select id from proposal where expires_at is null limit $1`, 500, async (rows) => {
 * 			for (const { id } of rows) await sql(`update proposal set expires_at = now() where id = $1`, [id]);
 * 		});
 * 	},
 * });
 * ```
 */
export function defineMigration<C = IContainer>(migration: Migration<C>): Migration<C> {
	return migration;
}
