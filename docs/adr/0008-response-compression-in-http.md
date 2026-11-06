# 0008. `@decohere/http` compresses responses by default: the `compression` setting, a thin wrapper around `@fastify/compress`

- **Status:** Proposed
- **Date:** 2026-10-12

## Context

Large JSON responses left the server at full size. Whether a CDN or load balancer compresses is a deployment detail; the framework should behave well on its own. Decohere wires a library up with good defaults and lets users override them, rather than re-implementing its policy. Fastify details stay in the provider ([architecture](../architecture/README.md#2-vendors-stay-at-the-composition-edge)).

## Decision

- **On by default, in every environment**, so what you test is what ships: the `compression` setting of `http(...)`, off with `compression: false`. A proxy that also compresses passes an encoded body through.
- **A thin wrapper.** `FastifyProvider` registers `@fastify/compress` with `global: true`, `threshold: 1024`, `encodings: ["br", "gzip"]`, and the plugin's defaults for the rest (compressible types, brotli quality 4, `Vary`, `HEAD`, already-encoded responses, `206`, errors). The HTTP package adds no eligibility logic.
- **Options map 1:1 onto the plugin.** `CompressionOptions` (`src/http/http.compression.ts`) is `false` or `{ threshold?, encodings?, types?, providerOptions? }`. `types` becomes the plugin's `customTypes`. `providerOptions` is an explicit Fastify escape hatch, merged last, for any other plugin option.
- **Server-sent events are excluded** by the plugin's default pattern (`text/` except `text/event-stream`). Compression buffers, so events would arrive late ([ADR 0005](0005-server-sent-events-in-http.md)). A test reads the first event of a stream while the producer is still running. A `types` matching `text/event-stream` overrides this.
- **BREACH.** Compressing an HTTPS response that holds both a secret and attacker-controlled input lets an attacker who sees response sizes recover the secret. That is typically HTML reflecting input beside a CSRF token. A JSON API with a bearer token in a header is low risk, since the token is not in the body. The README and the JSDoc of the `compression` setting say so; mitigations are masked per-response secrets, not reflecting input beside secrets, or `compression: false`.
- **Error replies are returned from the handler.** The exception path in `FastifyProvider` `return`s `reply.send(...)`; otherwise, with the plugin's async `onSend` hook, Fastify sent its own empty reply.

## Consequences

- Responses over 1 KB are smaller for clients that accept `br` or `gzip`, at a CPU cost. A CPU-bound service behind a compressing proxy can turn it off or raise the threshold.
- Plugin behaviour worth knowing: `types` replaces the default pattern but the MIME database still applies, so it is for adding types; the threshold does not apply to streams, so small static files are compressed; `application/octet-stream` is compressed; `Vary: Accept-Encoding` is only on compressed responses; `HEAD` is answered uncompressed; a `304` for a file can carry the `200`'s `Content-Encoding`.
- Static files are compressed on the fly; their `Cache-Control`, `ETag` and `304` are unchanged.
- Tests that read the wire use `node:http`, because `fetch` decodes compression itself.
- Not done: pre-compressed static files (`.br`, `.gz` built by forge, which would save CPU and allow the best brotli), request-body decompression, `zstd`, per-route opt-out.

## History

- 2026-10-12: Decided. A first version had its own eligibility hook and type allow-list; replaced by the thin wrapper before merge, because Decohere does not re-implement a library's policy.
- 2026-11-06: `withCompression` became the `compression` setting of `http(...)`, when the builder's extensions became plugins ([ADR 0014](0014-package-names.md)).
