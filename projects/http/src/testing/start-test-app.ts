import type { App } from "@decohere/core/hosting";
import {
	type EventStreamRead,
	type ReadEventsOptions,
	readEventStream,
} from "./sse-reader.js";

/** An app a test started with {@link startTestApp}. `await using` stops it at the end of the block. */
export type TestApp = AsyncDisposable & {
	app: App;
	/** Origin of the listening app, e.g. `http://127.0.0.1:41233`. */
	baseUrl: string;
	/** `GET path` as an `EventSource` would, and collect the first `count` events. */
	readEvents(path: string, options?: ReadEventsOptions): Promise<EventStreamRead>;
	/** Stop the app (closing any open streams). Same as `await using`. */
	stop(): Promise<void>;
};

/**
 * Start a built app on a free loopback port (`127.0.0.1:0`), so a test can call it over HTTP. The
 * app runs as it does in production: routing, auth, middleware and the real provider. It doesn't
 * stop on SIGTERM or SIGINT; stop it with `await using` or `stop()`.
 *
 * @example
 * await using api = await startTestApp(createApp());
 * const response = await fetch(`${api.baseUrl}/hello`);
 *
 * @throws whatever `app.start()` throws, after stopping the app.
 */
export async function startTestApp(app: App | PromiseLike<App>): Promise<TestApp> {
	const built = await app;
	const stop = () => built.dispose();
	try {
		await built.start({ port: 0, host: "127.0.0.1", shutdownSignals: false });
	} catch (error) {
		await stop();
		throw error;
	}
	const origin = built.addresses[0];
	if (origin == null) {
		await stop();
		throw new Error("The app started, but it advertised no address: is it serving HTTP?");
	}
	return {
		app: built,
		baseUrl: origin,
		readEvents: (path, options) => readEventStream(`${origin}${path}`, options),
		stop,
		[Symbol.asyncDispose]: stop,
	};
}
