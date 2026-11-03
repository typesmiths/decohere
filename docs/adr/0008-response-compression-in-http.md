# 0008. `@decohere/http` compresses responses by default: `withCompression`, a thin wrapper around `@fastify/compress`

- **Status:** Proposed
- **Date:** 2026-10-12 · updated 2026-10-21

## Context

A large JSON response left the server at full size. Whether a CDN or load balancer in front compresses is a deployment detail, and a framework should behave well on its own and let that be changed, not assume it. Decohere's approach to a library is to hook it up with best-practice defaults and let the user override them, not to re-implement its policy. Fastify details stay in the provider ([architecture](../architecture/#provider-boundaries--manage-vendor-lock-in)).

## Decision

- **On by default.** `builder.withCompression(options?)`; `withCompression(false)` turns it off. It applies in every environment, development included, so what you test is what ships. A proxy that also compresses sees an already-encoded body and passes it through, which is harmless; a missing one means a full-size API.
- **A thin wrapper.** `FastifyProvider` registers `@fastify/compress` with `global: true`, `threshold: 1024`, `encodings: ["br", "gzip"]` (no `deflate`, no `zstd`) and the plugin's own defaults for everything else (compressible types, brotli quality 4, `Vary`, `HEAD`, already-encoded responses, `206`, errors). The HTTP package adds no eligibility logic of its own.
- **Provider-neutral options, 1:1 onto the plugin.** `CompressionOptions` (in `src/http/http.compression.ts`) is `false` or `{ threshold?, encodings?, types?, providerOptions? }`. `types` is passed as the plugin's `customTypes`. `providerOptions` is an explicitly Fastify-specific escape hatch, merged last, so any other plugin option (`brotliOptions`, `zlibOptions`, `onUnsupportedEncoding`, ...) can be set or overridden. The neutral type and the defaults live in `@decohere/http`; only `FastifyProvider` touches the plugin.
- **Server-sent events are excluded by the plugin's default pattern** (`text/` except `text/event-stream`). That matters: compression buffers output, so events would arrive late or in bursts ([ADR 0005](0005-server-sent-events-in-http.md)). A test reads the first event of an open stream while the producer is still running. Passing a `types` that matches `text/event-stream` is the user overriding the default.
- **BREACH.** Compressing a response over HTTPS that contains both a secret and attacker-controlled input lets an attacker who can observe response sizes recover the secret a character at a time. In practice that is HTML reflecting input next to a CSRF token. A JSON API authenticated by a bearer token in a header is low risk: the token is not in the body. The caveat is documented next to the option (README and the JSDoc of `withCompression`). Mitigations: per-response masked secrets, not reflecting input beside secrets, or `withCompression(false)` for those routes.
- **Dependency.** `@fastify/compress` (MIT, maintained by the Fastify team), for negotiation, streams and errors.
- **Error replies are returned from the handler.** The exception path in `FastifyProvider` now `return`s `reply.send(...)`. With an asynchronous `onSend` hook (the plugin's), not returning let Fastify send an empty reply of its own, so a thrown error came out as an empty compressed body.

## Consequences

- JSON and text responses over 1 KB are smaller on the wire for clients that send `Accept-Encoding: br` or `gzip`, at the cost of CPU per response. A CPU-bound service behind a compressing proxy can turn it off or raise the threshold.
- Behaviour users should know, all the plugin's: `types` replaces the plugin's default pattern but the MIME database still applies, so it is for adding types; the threshold is not applied to streams, so small static files are compressed too; `application/octet-stream` is compressed by default; `Vary: Accept-Encoding` is only added to responses that are compressed; a `HEAD` is answered uncompressed because Fastify builds `HEAD` replies before the plugin runs; a `304` for a file can carry the `Content-Encoding` of the `200`, with no body.
- Static files are ordinary responses and are compressed on the fly; their `Cache-Control`, `ETag` and `304` are unchanged.
- Tests that read the wire need `node:http`, since Node's `fetch` negotiates and decodes compression itself.
- Not done: serving pre-compressed files (`.br`, `.gz` next to the originals, built by `forge`). It saves CPU for static assets and allows the slowest, best brotli, but needs a build step and a serving rule. On-the-fly compression is the baseline until then.
- Not done: request-body decompression, `zstd`, per-route opt-out.

## History

- 2026-10-12: Decided. A first version carried its own eligibility hook and a type allow-list; replaced by the thin wrapper before merge, because re-implementing a library's policy is not how Decohere uses libraries.
- 2026-10-21: Package names updated to the plain names of [ADR 0014](0014-package-names.md). The decision is unchanged.
