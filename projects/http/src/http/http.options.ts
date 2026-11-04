import type { Constructable } from "@decohere/core/reflection";
import type { OpenApiOptions } from "../openapi/openapi.types.js";
import type { CorsOptions } from "../routing/http.types.js";
import type { ExceptionFilter } from "../routing/filters/exception-filter.js";
import type { Middleware } from "../routing/middleware/middleware.js";
import type { CompressionOptions } from "./http.compression.js";
import type { StaticMount } from "./http.static.js";
import type { HelmetOptions, RateLimitOptions } from "./http.security.js";

/** Options for {@link Builder.withHttp} (request-id / access-log defaults, etc.). */
export type WithHttpOptions = {
	/**
	 * Register {@link HttpAccessLogMiddleware} (request id echo + Scribe access log).
	 * Defaults to `true`.
	 */
	accessLog?: boolean;
};

/** App-level HTTP options set via builder extensions (`withCors`, `withGlobalPrefix`, …). */
export class HttpOptions {
	public globalPrefix = "";
	/**
	 * Controllers put under the global prefix although they declare `globalPrefix: false`
	 * (`withHealth({ underGlobalPrefix: true })`).
	 */
	public readonly underGlobalPrefix = new Set<Constructable>();
	public cors?: CorsOptions;
	public openapi?: OpenApiOptions;
	/** `undefined` = helmet on with defaults; `false` = off; object = plugin options. */
	public helmet?: HelmetOptions;
	/** `undefined` = rate-limit on with defaults; `false` = off; object = plugin options. */
	public rateLimit?: RateLimitOptions;
	/** `undefined` = compression on with defaults; `false` = off; object = options. See `withCompression`. */
	public compression?: CompressionOptions;
	/** Request body size limit in bytes; `undefined` uses the 1 MiB default. */
	public bodyLimit?: number;
	/** Built UIs served from this API, see `withStatic`. */
	public statics: StaticMount[] = [];
	public middlewareTypes: Constructable<Middleware>[] = [];
	public filterTypes: Constructable<ExceptionFilter>[] = [];
}
