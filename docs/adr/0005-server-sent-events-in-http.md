# 0005. Server-sent events in `@decohere/http`: `@Sse()` on a route, one-way, before WebSockets

- **Status:** Accepted
- **Date:** 2026-10-11 · updated 2026-10-21

## Context

HTTP controllers could only return one complete response, so a UI that wants live data (Ledger's live PnL) had to poll. An earlier call was to skip WebSockets and SSE unless a product needs them; Ledger now does. The stream has to go through the same auth and middleware as every other route, must stop when the client leaves, and must not keep the app from stopping. Fastify details stay in the provider ([architecture](../architecture/#provider-boundaries--manage-vendor-lock-in)).

## Decision

- **API.** A route method is marked `@Sse({ heartbeatMs? })` and returns an `AsyncIterable` of `SseMessage` (`{ data, event?, id?, retry? }`, or a bare string for `data`). An `async *` method is the normal shape. Two parameter decorators fill in request state: `@Signal()` (an `AbortSignal`) and `@LastEventId()` (the reconnect header).
  - A decorator, not only a return type, because OpenAPI is generated from route metadata at startup and cannot see a return value. The same decorator also lets the router fail a non-stream return as a 500.
  - A plain `AsyncIterable` rather than a framework `EventStream` class: nothing to learn or construct, and any async source (generator, `events.on`, a Rx adapter) fits.
- **Pipeline.** The router runs auth, validation and middleware, then the handler, and only then hands an `SseResponse` to the provider. A rejection is therefore an ordinary 401/403 before any byte of the stream. The provider owns the wire: `text/event-stream` headers, heartbeat comments, and `connection: close`. The framing lives in provider-neutral code (`src/sse/`); only the "write this readable to the reply" step is Fastify.
- **Request scope** lives as long as the stream (`SseResponse.release()`), not as long as the handler call, because an `async *` body runs after the handler returns.
- **Cancellation.** `HttpRequest.signal` is aborted by the provider when the client's connection closes early or when the provider stops. The provider tracks open streams and aborts them first in `stop()`, so `app.dispose()` (SIGTERM, Flux reboot) ends streams instead of waiting on them.
- **Test helper.** `@decohere/http/testing` exports `bootModule` (real app on a free port) and `readEventStream`.
- **SSE before WebSockets.** SSE is one-way, plain HTTP (the existing auth, proxies, load balancers and CORS work unchanged), and the browser reconnects and resumes with `Last-Event-ID` by itself. WebSockets would need a second protocol, a second auth path and its own lifecycle. Add them when a product needs client-to-server messages, as a separate decision.

## Consequences

- A producer that ignores the signal cannot be force-stopped (JavaScript cannot cancel a pending `await`). The HTTP package ends the response and moves on, but the producer lives until its current `await` settles. This is documented in the README.
- Each stream holds a connection and a request scope for its whole life, and closes the connection when it ends.
- No `Last-Event-ID` replay buffer: the handler owns resuming, because only the app knows its event history.
- Producer errors after the headers are sent are logged and the stream ends; the browser reconnects.
- **Left for hosted services** ([ADR 0010](0010-hosted-services.md)): the stop path here lives in the Fastify provider's `stop()`, not in a general `HostedService` contract. With hosted services, streams stay as they are (they are tied to HTTP connections, not background workers). What hosted services own is background workers and the container disposal on SIGTERM and Flux reboot. A test that runs a real Flux reboot with open streams does not exist yet: the tests call `app[Symbol.asyncDispose]()`, which is what Flux calls, but not Flux itself.
- Not covered: HTTP/2 specifics, per-connection limits, and compression (the compression plugin's default skips `text/event-stream`, [ADR 0008](0008-response-compression-in-http.md); a compressing proxy must not buffer it either, and `x-accel-buffering: no` is sent for nginx).

## History

- 2026-10-11: Decided.
- 2026-10-21: Package names updated to the plain names of [ADR 0014](0014-package-names.md). The decision is unchanged.
