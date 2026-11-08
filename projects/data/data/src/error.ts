export class DataError extends Error {}
export class DataConfigurationError extends Error {}

/** The row changed since this unit of work loaded it: its version no longer matches. */
export class OptimisticLockError extends DataError {}
