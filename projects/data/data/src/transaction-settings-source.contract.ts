/**
 * Where a data source's unit of work gets its {@link TransactionSettings}: a service of the app's,
 * usually request-scoped, given to the provider plugin as `settings`. It is asked at the start of
 * each transaction, so it can answer from what the request learned after the unit of work was made,
 * such as the signed-in principal's tenant.
 *
 * Return no entries to set nothing: the transaction still begins, and a policy that reads a missing
 * setting with `current_setting(name, true)` sees null.
 */
export interface TransactionSettingsSource {
	transactionSettings(): Readonly<Record<string, string>>;
}
