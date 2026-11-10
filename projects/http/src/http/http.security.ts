/**
 * Default HTTP security settings, applied by the HTTP provider when `http(...)` is used.
 * Override via `helmet` / `rateLimit` / `bodyLimit` (pass `false` to disable helmet or rate-limit).
 */

/** Request body size limit (bytes). Matches Fastify's built-in default, made explicit and overridable. */
export const DEFAULT_HTTP_BODY_LIMIT = 1_048_576;

/** Global request rate limit applied unless disabled or customized. */
export const DEFAULT_HTTP_RATE_LIMIT = {
	max: 100,
	timeWindow: "1 minute",
} as const;

/** `false` turns the security headers off; an object customizes them (helmet's options). */
export type HelmetOptions = false | Record<string, unknown>;

/** `false` turns the rate limit off; an object customizes it, passed on to the provider's limiter. */
export type RateLimitOptions =
	| false
	| {
			max?: number;
			timeWindow?: number | string;
			[key: string]: unknown;
	  };
