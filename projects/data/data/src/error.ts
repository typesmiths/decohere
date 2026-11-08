export class DataError extends Error {}
export class DataConfigurationError extends Error {}

/** The row changed since this unit of work loaded it: its version no longer matches. */
export class OptimisticLockError extends DataError {}

/** A migration failed and was rolled back; its `cause` is what it threw. */
export class MigrationError extends DataError {
	public constructor(
		public readonly migrationId: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(`Migration ${migrationId}: ${message}`, options);
	}
}
