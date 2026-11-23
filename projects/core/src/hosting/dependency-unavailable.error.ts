/**
 * Something a request needs can't be reached right now: a database still connecting, or down
 * while the app retries its start. HTTP answers `503 Service Unavailable`, without the reason,
 * which is logged instead (it can name hosts).
 */
export class DependencyUnavailableError extends Error {
	public override readonly name = "DependencyUnavailableError";

	/** `dependency` names what is missing, such as `data source "orders"`. */
	public constructor(
		public readonly dependency: string,
		reason?: string,
		options?: ErrorOptions,
	) {
		super(
			reason == null
				? `${dependency} is unavailable`
				: `${dependency} is unavailable: ${reason}`,
			options,
		);
	}
}
