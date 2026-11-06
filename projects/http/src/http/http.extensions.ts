import type { ContainerBuilder, IContainer } from "@decohere/crucible";
import { extension } from "@decohere/core/extensibility";
import type { Constructable } from "@decohere/core/reflection";
import { scribe } from "@decohere/scribe";
import { PrincipalProvider } from "../auth/principal-provider.js";
import { Builder } from "@decohere/core/hosting";
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
import type { WithHttpOptions } from "./http.options.js";
import { getOrCreateHttpOptions } from "./http.options.store.js";
import type { CompressionOptions } from "./http.compression.js";
import type { HelmetOptions, RateLimitOptions } from "./http.security.js";
import { type StaticOptions, staticFiles } from "./http.static.js";

const httpProviderStore = new WeakMap<Builder, Constructable<HttpProvider>>();
const controllersStore = new WeakMap<Builder, Constructable[]>();

declare module "@decohere/core/hosting" {
	interface Builder {
		withHttpProvider<Thttp extends Constructable<HttpProvider>>(type: Thttp): Builder;
		/**
		 * HTTP provider plus scaffold defaults (request id + Scribe access log).
		 * Prefer this over {@link Builder.withHttpProvider} for application entrypoints.
		 */
		withHttp<Thttp extends Constructable<HttpProvider>>(
			type: Thttp,
			options?: WithHttpOptions,
		): Builder;
		withControllers(...controllers: Constructable[]): Builder;
		/**
		 * Prefix every controller route (`/api` makes `/lp/portfolio` into `/api/lp/portfolio`).
		 * It covers controller routes only: not static mounts (`withStatic`), not the OpenAPI
		 * document, and not a controller declared with `@Controller({ globalPrefix: false })`,
		 * such as the `withHealth()` probes, which platforms expect at the root. With a prefix
		 * set, the static fallback treats everything under it as the API.
		 */
		withGlobalPrefix(prefix: string): Builder;
		withCors(options: CorsOptions): Builder;
		/**
		 * Override or disable default `@fastify/helmet` headers.
		 * Defaults are on with `withHttpProvider`; pass `false` to disable.
		 */
		withHelmet(options?: HelmetOptions): Builder;
		/**
		 * Override or disable default `@fastify/rate-limit` (100 req / 1 minute).
		 * Pass `false` to disable.
		 */
		withRateLimit(options?: RateLimitOptions): Builder;
		/**
		 * Compress responses with `br` or `gzip` when the client accepts it, using `@fastify/compress`
		 * with best-practice defaults (on by default, 1 KB threshold, no `deflate`). Pass `false` to
		 * turn it off, or `{ threshold, encodings, types, providerOptions }` to override. The plugin
		 * does not compress `text/event-stream` by default. Compressing a response that mixes a secret
		 * with input an attacker controls can leak the secret over HTTPS (BREACH); see ADR 0008.
		 */
		withCompression(options?: CompressionOptions): Builder;
		/**
		 * Override the default request body size limit (1 MiB).
		 */
		withBodyLimit(bytes: number): Builder;
		withMiddleware(...middlewares: Constructable<Middleware>[]): Builder;
		withExceptionFilters(...filters: Constructable<ExceptionFilter>[]): Builder;
		withOpenApi(options: OpenApiOptions): Builder;
		/**
		 * Serve a built UI (a folder of static files) from this API, for example
		 * `.withStatic("/ui/", "ui")`. The directory is resolved from the process working
		 * directory, like `./config`. The files are public: they are served before auth,
		 * validation and middleware, and outside the rate limit. An unknown path under the prefix
		 * serves `index.html` to a browser (`Accept: text/html`) so client routes survive a reload. `"/"` mounts it at the root. Hashed assets are cached for a
		 * year, `index.html` is not cached. See {@link StaticOptions}.
		 */
		withStatic(prefix: string, directory: string, options?: StaticOptions): Builder;
	}
}

export class BuilderExtensions {
	@extension(Builder)
	public static withHttpProvider<Thttp extends Constructable<HttpProvider>>(
		builder: Builder,
		type: Thttp,
	) {
		httpProviderStore.set(builder, type);
		const httpOptions = getOrCreateHttpOptions(builder);

		builder.withServices((containerBuilder: ContainerBuilder) => {
			const logger = scribe.logger("BuilderExtensions");
			logger.trace("Configuring Http Provider");

			const http = httpProviderStore.get(builder);
			if (!http) {
				return;
			}

			containerBuilder.registerSingleton(HttpOptionsToken, httpOptions);
			containerBuilder.registerSingleton(HttpProviderToken, http);
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

			const controllers = controllersStore.get(builder) || [];
			for (const controllerFn of controllers) {
				containerBuilder.registerRequestScoped(controllerFn);
			}
		});

		builder.registerPostBuildStep((container: IContainer) => {
			const logger = scribe.logger("BuilderExtensions");
			const registry = container.resolve<RouteRegistry>(RouteRegistryToken);
			const controllers = controllersStore.get(builder) || [];
			for (const controllerFn of controllers) {
				logger.trace(`Add routes from ${controllerFn.name}`);
				registry.addController(controllerFn);
			}
		});

		return builder;
	}

	@extension(Builder)
	public static withHttp<Thttp extends Constructable<HttpProvider>>(
		builder: Builder,
		type: Thttp,
		options?: WithHttpOptions,
	) {
		const accessLog = options?.accessLog !== false;
		if (accessLog) {
			const httpOptions = getOrCreateHttpOptions(builder);
			if (!httpOptions.middlewareTypes.includes(HttpAccessLogMiddleware)) {
				httpOptions.middlewareTypes = [
					...httpOptions.middlewareTypes,
					HttpAccessLogMiddleware,
				];
			}
		}
		return BuilderExtensions.withHttpProvider(builder, type);
	}

	@extension(Builder)
	public static withControllers(builder: Builder, ...controllers: Constructable[]) {
		const existing = controllersStore.get(builder) || [];
		controllersStore.set(builder, [...existing, ...controllers]);
		return builder;
	}

	@extension(Builder)
	public static withGlobalPrefix(builder: Builder, prefix: string) {
		getOrCreateHttpOptions(builder).globalPrefix = prefix;
		return builder;
	}

	@extension(Builder)
	public static withCors(builder: Builder, options: CorsOptions) {
		getOrCreateHttpOptions(builder).cors = options;
		return builder;
	}

	@extension(Builder)
	public static withHelmet(builder: Builder, options: HelmetOptions = {}) {
		getOrCreateHttpOptions(builder).helmet = options;
		return builder;
	}

	@extension(Builder)
	public static withRateLimit(builder: Builder, options: RateLimitOptions = {}) {
		getOrCreateHttpOptions(builder).rateLimit = options;
		return builder;
	}

	@extension(Builder)
	public static withCompression(builder: Builder, options: CompressionOptions = {}) {
		getOrCreateHttpOptions(builder).compression = options;
		return builder;
	}

	@extension(Builder)
	public static withBodyLimit(builder: Builder, bytes: number) {
		getOrCreateHttpOptions(builder).bodyLimit = bytes;
		return builder;
	}

	@extension(Builder)
	public static withMiddleware(builder: Builder, ...middlewares: Constructable<Middleware>[]) {
		const httpOptions = getOrCreateHttpOptions(builder);
		httpOptions.middlewareTypes = [...httpOptions.middlewareTypes, ...middlewares];
		return builder;
	}

	@extension(Builder)
	public static withExceptionFilters(
		builder: Builder,
		...filters: Constructable<ExceptionFilter>[]
	) {
		const httpOptions = getOrCreateHttpOptions(builder);
		httpOptions.filterTypes = [...httpOptions.filterTypes, ...filters];
		return builder;
	}

	@extension(Builder)
	public static withOpenApi(builder: Builder, options: OpenApiOptions) {
		getOrCreateHttpOptions(builder).openapi = {
			validateRequests: true,
			path: "/openapi.json",
			...options,
		};
		return builder;
	}

	@extension(Builder)
	public static withStatic(
		builder: Builder,
		prefix: string,
		directory: string,
		options?: StaticOptions,
	) {
		const httpOptions = getOrCreateHttpOptions(builder);
		httpOptions.statics = [
			...httpOptions.statics,
			staticFiles.toMount(prefix, directory, options),
		];
		return builder;
	}
}
