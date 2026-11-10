import { http } from "../http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import type { ContainerBuilder } from "@decohere/crucible";
import type { Constructable } from "@decohere/core/reflection";
import { Builder } from "@decohere/core/hosting";
import type { HttpProvider } from "../routing/http.types.js";
import { startTestApp, type TestApp } from "./start-test-app.js";

export type BootModuleOptions = {
	/** The web server, as the app composes it: `FastifyProvider` from `@decohere/http-fastify`. */
	provider: Constructable<HttpProvider>;
	controllers: Constructable[];
	/** Register services the controllers need. */
	services?: (containerBuilder: ContainerBuilder) => void;
	/** Add anything else to the builder (`config(...)`, `auth()`, ...) before the app is built. */
	configure?: (builder: Builder) => unknown;
};

/**
 * Build an app of only the given controllers and the services they need, and start it with
 * {@link startTestApp}: a module tested on its own, without the rest of the app.
 *
 * @example
 * await using api = await bootModule({ provider: FastifyProvider, controllers: [PriceController] });
 * const { events } = await api.readEvents("/prices/stream", { count: 3 });
 */
export async function bootModule(options: BootModuleOptions): Promise<TestApp> {
	let builder = Builder.create(new ServiceContainerBuilder()).use(
		http(options.provider, { controllers: [...options.controllers] }),
	);
	if (options.services) builder = builder.withServices(options.services);
	options.configure?.(builder);
	return startTestApp(builder.build());
}
