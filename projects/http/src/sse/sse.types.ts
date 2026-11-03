/**
 * One server-sent event. A bare `string` yielded by a handler is shorthand for `{ data }`.
 *
 * `data` is written as-is when it is a string and as JSON otherwise.
 */
export type SseMessage<T = unknown> = {
	data: T;
	/** Becomes the `event:` field; the browser dispatches it to `addEventListener(event, ...)`. */
	event?: string;
	/** Becomes the `id:` field; the browser sends the last one back as `Last-Event-ID` on reconnect. */
	id?: string;
	/** Tells the browser how many milliseconds to wait before reconnecting. */
	retry?: number;
};

/** What a `@Sse()` handler returns: any async iterable of messages (an `async *` method is the usual shape). */
export type SseStream<T = unknown> = AsyncIterable<SseMessage<T> | string>;

export type SseOptions = {
	/**
	 * Milliseconds of silence before the HTTP package writes a `: heartbeat` comment, which keeps proxies
	 * and load balancers from closing an idle connection. Default 15000. `0` turns heartbeats off.
	 */
	heartbeatMs?: number;
};

export const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

/**
 * What the router hands the HTTP provider for an `@Sse()` route. The request-scoped services the
 * handler uses must stay alive for as long as the stream runs, so the provider calls `release()`
 * once the stream is over, instead of the router disposing them as soon as the handler returns.
 */
export class SseResponse {
	private released: Promise<void> | undefined;

	public constructor(
		public readonly events: AsyncIterable<unknown>,
		private readonly onRelease: () => Promise<void>,
	) {}

	/** Safe to call more than once. */
	public release(): Promise<void> {
		this.released ??= this.onRelease();
		return this.released;
	}
}
