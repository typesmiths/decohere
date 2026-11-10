import { http } from "../http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import type { ContainerBuilder } from "@decohere/crucible";
import type { Constructable } from "@decohere/core/reflection";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "@decohere/http-fastify";
import type { HttpProvider } from "../routing/http.types.js";
import {
	type EventStreamRead,
	type ReadEventsOptions,
	readEventStream,
} from "./sse-reader.js";

export type BootModuleOptions = {
	controllers: Constructable[];
	/** Register services the controllers need. */
	services?: (containerBuilder: ContainerBuilder) => void;
	/** Add anything else to the builder (`auth()`, `openApi`, ...) before the app is built. */
	configure?: (builder: Builder) => unknown;
	/** Defaults to the Fastify provider. */
	provider?: Constructable<HttpProvider>;
};

export type BootedModule = AsyncDisposable & {
	app: App;
	/** Origin of the listening app, e.g. `http://127.0.0.1:41233`. */
	baseUrl: string;
	/** `GET path` as an `EventSource` would, and collect the first `count` events. */
	readEvents(path: string, options?: ReadEventsOptions): Promise<EventStreamRead>;
	/** Stop the app (closing any open streams). Same as `await using`. */
	stop(): Promise<void>;
};

/**
 * Boot the given controllers as a real app on a free loopback port, so a test can call it over
 * HTTP. The app runs the full pipeline: routing, auth, middleware, and the real provider.
 *
 * @example
 * await using api = await bootModule({ controllers: [PriceController] });
 * const { events } = await api.readEvents("/prices/stream", { count: 3 });
 */
export async function bootModule(options: BootModuleOptions): Promise<BootedModule> {
	let builder = Builder.create(new ServiceContainerBuilder()).use(
		http(options.provider ?? FastifyProvider, { controllers: [...options.controllers] }),
	);
	if (options.services) builder = builder.withServices(options.services);
	options.configure?.(builder);
	const app = await builder.build();
	await app.start({ port: 0, host: "127.0.0.1", shutdownSignals: false });
	const baseUrl = app.addresses[0];
	if (baseUrl == null) {
		await app.dispose();
		throw new Error("app.start({ port: 0 }) advertised no IPv4 address");
	}
	const stop = () => app.dispose();
	return {
		app,
		baseUrl,
		readEvents: (path, readOptions) => readEventStream(`${baseUrl}${path}`, readOptions),
		stop,
		[Symbol.asyncDispose]: stop,
	};
}
