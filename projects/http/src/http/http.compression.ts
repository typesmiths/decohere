/**
 * Response compression (the `compression` setting). Provider-neutral options and defaults;
 * the HTTP provider hands them to its compression plugin and the plugin owns the policy
 * (which responses are compressed, `Vary`, `HEAD`, streams). See ADR 0008.
 */

/** A content coding the HTTP package can offer. */
export type CompressionEncoding = "br" | "gzip" | "deflate";

/** Bodies smaller than this many bytes are sent as they are (not applied to streams, such as files). */
export const DEFAULT_COMPRESSION_THRESHOLD = 1024;

/** The codings offered by default, in order of preference. `deflate` is left out on purpose. */
export const DEFAULT_COMPRESSION_ENCODINGS: readonly CompressionEncoding[] = ["br", "gzip"];

/** Options for the `compression` setting. `false` turns compression off. */
export type CompressionOptions =
	| false
	| {
			/** Smallest body, in bytes, that is compressed. Defaults to 1024. Not applied to streamed bodies. */
			threshold?: number;
			/** The codings to offer, in order of preference. Defaults to `["br", "gzip"]`. */
			encodings?: CompressionEncoding[];
			/**
			 * Content types to compress, tested against the `Content-Type` header. Passed to the
			 * plugin as `customTypes`: it replaces the plugin's default pattern (text, JSON, XML,
			 * `octet-stream`; never `text/event-stream`) and anything the MIME database marks
			 * compressible is still compressed. Use it to add a type; do not match
			 * `text/event-stream` unless you want streams buffered.
			 */
			types?: RegExp | ((contentType: string) => boolean);
			/**
			 * Fastify-specific. Any other `@fastify/compress` option (`brotliOptions`, `zlibOptions`,
			 * `onUnsupportedEncoding`, `inflateIfDeflated`, ...), merged last so it overrides the
			 * values above. Not portable to another HTTP provider.
			 */
			providerOptions?: Record<string, unknown>;
	  };
