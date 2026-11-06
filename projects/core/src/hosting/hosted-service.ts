/**
 * Work that runs for the life of the app outside a request: a feed, a poller, a queue consumer.
 * Register it with `builder.withHostedService(Type)`; it is a singleton, so other services can
 * inject it by its class.
 *
 * The app starts hosted services in registration order before the HTTP server listens, and stops
 * them in reverse order when it stops (`app.dispose()`, SIGTERM or SIGINT, a Flux reboot).
 */
export interface HostedService {
	/**
	 * Called once when the app starts, and awaited: a throw fails `app.start()`. Do what must be
	 * ready before traffic, then start long work (a first load that takes minutes, a timer) in
	 * the background and return. Waiting for it here keeps the HTTP server dark.
	 *
	 * `signal` is aborted as soon as the app starts stopping, before `stop()` is called, also
	 * while `start()` itself is still running. Stop background work and clear timers on it.
	 */
	start(signal: AbortSignal): Promise<void> | void;
	/**
	 * Called once when the app stops, after the HTTP server has drained and before the container
	 * is disposed, so the services it uses (a DataSource) are still open. Wait here for the
	 * background work to finish. Optional: a service with nothing to wait for can rely on the
	 * signal, or on `Symbol.asyncDispose`, which the container calls later.
	 */
	stop?(): Promise<void> | void;
	/**
	 * Readiness while the service is started but still warming up: throw until it can serve, and
	 * `GET /ready` answers 503 (`withHealth()`). Optional.
	 */
	check?(): Promise<void>;
}
