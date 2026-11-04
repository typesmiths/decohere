# 0005. Server-sent events in `@decohere/http`: `@Sse()` on a route, one-way, before WebSockets

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

Controllers could only return one complete response, so a UI that wanted live data had to poll. A stream must go through the same auth and middleware as any route, stop when the client leaves, and not keep the app from stopping. Fastify details stay in the provider ([architecture](../architecture/README.md#2-vendors-stay-at-the-composition-edge)).

## Decision

- **API.** A route method is marked `@Sse({ heartbeatMs? })` and returns an `AsyncIterable` of `SseMessage` (`{ data, event?, id?, retry? }`, or a bare string for `data`); usually an `async *` method. `@Signal()` injects an `AbortSignal`, `@LastEventId()` the reconnect header.
  - A decorator, not just a return type, because OpenAPI is built from route metadata at startup and cannot see a return value. It also lets the router fail a non-stream return as a 500.
  - A plain `AsyncIterable`, not a framework `EventStream` class: nothing to learn, and any async source (generator, `events.on`, an Rx adapter) fits.
- **Pipeline.** The router runs auth, validation, middleware and the handler, then hands an `SseResponse` to the provider. A rejection is an ordinary 401/403 before the stream starts. The provider owns the wire (`text/event-stream` headers, heartbeat comments, `connection: close`, `x-accel-buffering: no`). Framing is provider-neutral (`src/sse/`); only writing the stream to the reply is Fastify.
- **Request scope** lasts as long as the stream (`SseResponse.release()`), not the handler call, because an `async *` body runs after the handler returns.
- **Cancellation.** The provider aborts `HttpRequest.signal` when the client disconnects or the provider stops. It tracks open streams and aborts them first in `stop()`, so `app.dispose()` (SIGTERM, Flux reboot) ends streams instead of waiting on them.
- **Testing.** `@decohere/http/testing` exports `bootModule` (a real app on a free port) and `readEventStream`.
- **SSE before WebSockets.** SSE is one-way plain HTTP: existing auth, proxies, load balancers and CORS work unchanged, and the browser reconnects with `Last-Event-ID` by itself. WebSockets need a second protocol, auth path and lifecycle. Add them, as a separate decision, when a product needs client-to-server messages.

## Consequences

- A producer that ignores the signal cannot be force-stopped (JavaScript cannot cancel a pending `await`). The response ends, but the producer lives until its current `await` settles. The README says so.
- Each stream holds a connection and a request scope for its whole life.
- No `Last-Event-ID` replay buffer: only the app knows its event history, so the handler resumes.
- A producer error after the headers are sent is logged and ends the stream; the browser reconnects.
- Streams are stopped by the provider, not by hosted services ([ADR 0010](0010-hosted-services.md)): they belong to HTTP connections, not background work. Tests call `app[Symbol.asyncDispose]()`, which is what Flux calls; no test runs a real Flux reboot with open streams.
- Compression skips `text/event-stream` ([ADR 0008](0008-response-compression-in-http.md)); a compressing proxy must not buffer it either.
- Not covered: HTTP/2 specifics, per-connection limits.

## History

- 2026-10-11: Decided.
