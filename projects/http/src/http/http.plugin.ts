import type { Builder, BuilderPlugin } from "@decohere/core/hosting";
import type { ContainerBuilder, IContainer } from "@decohere/crucible";
import type { Constructable } from "@decohere/core/reflection";
import { scribe } from "@decohere/scribe";
import { PrincipalProvider } from "../auth/principal-provider.js";
import {
	ExceptionFilterHostToken,
	HttpOptionsToken,
	HttpProviderToken,
	IPrincipalProviderToken,
	RouteRegistryToken,
	RouterToken,
} from "../const.js";
import type { OpenApiOptions } from "../openapi/openapi.types.js";
import type { CorsOptions, HttpProvider } from "../routing/http.types.js";
import type { ExceptionFilter } from "../routing/filters/exception-filter.js";
import { ExceptionFilterHost } from "../routing/filters/exception-filter-host.js";
import { HttpAccessLogMiddleware } from "../routing/middleware/http-access-log.middleware.js";
import type { Middleware } from "../routing/middleware/middleware.js";
import { RouteRegistry } from "../routing/services/route-registry.js";
import { Router } from "../routing/services/router.js";
import type { CompressionOptions } from "./http.compression.js";
import { getOrCreateHttpOptions } from "./http.options.store.js";
import type { HelmetOptions, RateLimitOptions } from "./http.security.js";
import { type StaticOptions, staticFiles } from "./http.static.js";

const controllersStore = new WeakMap<Builder, Constructable[]>();

/** A built UI to serve. See {@link HttpSettings.statics}. */
export type StaticEntry = StaticOptions & { prefix: string; directory: string };

/** What {@link http} and {@link configureHttp} can set. */
export type HttpSettings = {
	controllers?: Constructable[];
	/**
	 * Prefix every controller route (`/api` makes `/lp/portfolio` into `/api/lp/portfolio`).
	 * It covers controller routes only: not `statics`, not the OpenAPI document, and not a
	 * controller declared with `@Controller({ globalPrefix: false })`, such as the `health()`
	 * probes, which platforms expect at the root. With a prefix set, the static fallback treats
	 * everything under it as the API.
	 */
	globalPrefix?: string;
	cors?: CorsOptions;
	/** Override default `@fastify/helmet` headers, or `false` to turn them off. On by default. */
	helmet?: HelmetOptions;
	/** Override the default `@fastify/rate-limit` (100 req / 1 minute), or `false` to turn it off. */
	rateLimit?: RateLimitOptions;
	/**
	 * Compress responses with `br` or `gzip` when the client accepts it, using `@fastify/compress`
	 * with best-practice defaults (on by default, 1 KB threshold, no `deflate`). Pass `false` to
	 * turn it off, or `{ threshold, encodings, types, providerOptions }` to override. The plugin
	 * does not compress `text/event-stream` by default. Compressing a response that mixes a secret
	 * with input an attacker controls can leak the secret over HTTPS (BREACH); see ADR 0008.
	 */
	compression?: CompressionOptions;
	/** Override the default request body size limit (1 MiB). */
	bodyLimit?: number;
	middleware?: Constructable<Middleware>[];
	exceptionFilters?: Constructable<ExceptionFilter>[];
	openApi?: OpenApiOptions;
	/**
	 * Serve built UIs (folders of static files) from this API, for example
	 * `{ prefix: "/ui/", directory: "ui" }`. The directory is resolved from the process working
	 * directory, like `./config`. The files are public: they are served before auth, validation
	 * and middleware, and outside the rate limit. An unknown path under the prefix serves
	 * `index.html` to a browser (`Accept: text/html`) so client routes survive a reload. `"/"`
	 * mounts it at the root. Hashed assets are cached for a year, `index.html` is not cached.
	 */
	statics?: StaticEntry[];
};

export type HttpPluginOptions = HttpSettings & {
	/** Register {@link HttpAccessLogMiddleware} (request id echo + Scribe access log). Default `true`. */
	accessLog?: boolean;
};

/**
 * Serve HTTP from this app, on the given provider.
 *
 * @example
 * builder.use(http(FastifyProvider, { controllers: [HelloController] }));
 */
export function http<Thttp extends Constructable<HttpProvider>>(
	provider: Thttp,
	options: HttpPluginOptions = {},
): BuilderPlugin {
	return (builder) => {
		const { accessLog, ...settings } = options;
		const httpOptions = getOrCreateHttpOptions(builder);

		if (
			accessLog !== false &&
			!httpOptions.middlewareTypes.includes(HttpAccessLogMiddleware)
		) {
			httpOptions.middlewareTypes = [...httpOptions.middlewareTypes, HttpAccessLogMiddleware];
		}

		builder.withServices((containerBuilder: ContainerBuilder) => {
			scribe.logger("http").trace("Configuring Http Provider");

			containerBuilder.registerSingleton(HttpOptionsToken, httpOptions);
			containerBuilder.registerSingleton(HttpProviderToken, provider);
			containerBuilder.registerSingleton(RouterToken, Router);
			containerBuilder.registerSingleton(RouteRegistryToken, RouteRegistry);
			containerBuilder.registerSingleton(ExceptionFilterHostToken, ExceptionFilterHost);
			containerBuilder.registerRequestScoped(IPrincipalProviderToken, PrincipalProvider);

			for (const middlewareType of httpOptions.middlewareTypes) {
				containerBuilder.registerSingleton(middlewareType);
			}
			for (const filterType of httpOptions.filterTypes) {
				containerBuilder.registerSingleton(filterType);
			}
			for (const controller of controllersStore.get(builder) ?? []) {
				containerBuilder.registerRequestScoped(controller);
			}
		});

		builder.registerPostBuildStep((container: IContainer) => {
			const logger = scribe.logger("http");
			const registry = container.resolve<RouteRegistry>(RouteRegistryToken);
			for (const controller of controllersStore.get(builder) ?? []) {
				logger.trace(`Add routes from ${controller.name}`);
				registry.addController(controller);
			}
		});

		configureHttp(settings)(builder);
	};
}

/**
 * Add to the HTTP settings from somewhere other than the {@link http} call, such as a plugin of
 * your own that brings its controllers. Lists add up; a single value replaces the one before it.
 */
export function configureHttp(settings: HttpSettings): BuilderPlugin {
	return (builder) => {
		const options = getOrCreateHttpOptions(builder);
		if (settings.controllers) {
			controllersStore.set(builder, [
				...(controllersStore.get(builder) ?? []),
				...settings.controllers,
			]);
		}
		if (settings.globalPrefix !== undefined) options.globalPrefix = settings.globalPrefix;
		if (settings.cors !== undefined) options.cors = settings.cors;
		if (settings.helmet !== undefined) options.helmet = settings.helmet;
		if (settings.rateLimit !== undefined) options.rateLimit = settings.rateLimit;
		if (settings.compression !== undefined) options.compression = settings.compression;
		if (settings.bodyLimit !== undefined) options.bodyLimit = settings.bodyLimit;
		if (settings.middleware) {
			options.middlewareTypes = [...options.middlewareTypes, ...settings.middleware];
		}
		if (settings.exceptionFilters) {
			options.filterTypes = [...options.filterTypes, ...settings.exceptionFilters];
		}
		if (settings.openApi) {
			options.openapi = { validateRequests: true, path: "/openapi.json", ...settings.openApi };
		}
		for (const { prefix, directory, ...staticOptions } of settings.statics ?? []) {
			options.statics = [
				...options.statics,
				staticFiles.toMount(prefix, directory, staticOptions),
			];
		}
	};
}
