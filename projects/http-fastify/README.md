# @decohere/http-fastify

The [Fastify](https://fastify.dev) provider for [`@decohere/http`](../http/README.md): `FastifyProvider`, the web server that serves an app's controllers. `@decohere/http` holds the controllers, routing, auth, OpenAPI, health and problem details; this package is where Fastify and its plugins are. Why the split: [architecture §2](../../docs/architecture/README.md#2-vendors-stay-at-the-composition-edge).

```bash
npm install @decohere/http @decohere/http-fastify
```

Pass the provider to `http(...)` at the app's composition root:

```ts
import { Builder } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { health, http } from "@decohere/http";
import { FastifyProvider } from "@decohere/http-fastify";

await Builder.create(new ServiceContainerBuilder())
	.use(http(FastifyProvider, { controllers: [HelloController] }))
	.use(health())
	.buildAndStart();
```

Controllers and services never import this package. Swapping the web server is changing that one line.

## What it does with each setting

The settings are `@decohere/http`'s `HttpSettings`, documented there. This is how Fastify carries them out.

| Setting | Default | Fastify |
|---|---|---|
| `helmet` | on | [`@fastify/helmet`](https://github.com/fastify/fastify-helmet); an object is passed to it, `false` leaves it out |
| `rateLimit` | 100 requests a minute | [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit); an object is merged over the default. Static files are exempt, matched on the route Fastify resolved, not on the URL |
| `cors` | off | [`@fastify/cors`](https://github.com/fastify/fastify-cors) with the options given |
| `compression` | on | [`@fastify/compress`](https://github.com/fastify/fastify-compress), registered before any route ([below](#compression)) |
| `statics` | none | [`@fastify/static`](https://github.com/fastify/fastify-static), one encapsulated context per mount, whose not-found handler is the SPA fallback |
| `bodyLimit` | 1 MiB | Fastify's `bodyLimit` |
| `openApi` | off | a `GET` route that returns the generated document |

A request Fastify answers itself, before any handler, is a problem like the API's (`application/problem+json`): an unknown route (`404`, `detail: "Route GET:/nope not found"`), a body that isn't valid JSON or is too large, the rate limit. Fastify matches a registered route before a static wildcard, so a UI served from `/` never shadows the API.

## Compression

`@fastify/compress` owns the policy, with `global: true` and the setting's threshold and encodings. Its default list of compressible types is text, JSON, XML, `octet-stream` and anything the MIME database marks compressible; images, video, woff2 fonts, zip and PDF are not compressed again. `compression.providerOptions` takes any other `@fastify/compress` option, merged last:

```ts
compression: {
	providerOptions: { brotliOptions: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } } },
}
```

What to know about the plugin's behaviour:

- **`types` is for adding types.** It is passed as `customTypes`: it replaces the plugin's default pattern, but anything the MIME database marks compressible is still compressed. Do not match `text/event-stream` unless you want streams buffered.
- **The threshold does not apply to streams.** Files served by `statics` are streams, so even a small text file is compressed on the fly. Their `Cache-Control`, `ETag` and `304` behave as before.
- **`application/octet-stream` is compressed by default.** If you serve already-compressed bytes under that type, set the `Content-Type` of the real format or set your own `Content-Encoding`.
- **Server-sent events are not compressed** by the plugin's default pattern. Keep it that way.
- **Unread streamed bodies hold up stopping.** A compressed file stays open until the client has read it, so `app.dispose()` waits for a client that fetched a static file and never read the body. In tests, read or cancel the body (or send `Accept-Encoding: identity`).
- **Already encoded.** A response that sets its own `Content-Encoding` is passed through.
- **`Vary: Accept-Encoding`** is added when a response is compressed.
- **`HEAD`** is answered uncompressed: Fastify builds a `HEAD` reply before the plugin runs, so it has the plain `Content-Length` and no `Vary`. It has no body either way.
- **A `304`** for a file can carry the `Content-Encoding` header of the `200` it stands for. It has no body.
- **Helmet, CORS and the rate limit** are unaffected, and an error reply (a `401`, a `400` with a large body) is compressed like any other.
- **Pre-compressed files.** Serving `.br`/`.gz` files built ahead of time is a possible later step; today static files are compressed on the fly.

Why this shape: [ADR 0008](../../docs/adr/0008-response-compression-in-http.md).

## Streams and stopping

- **Server-sent events.** `@decohere/http` frames the events; the provider writes them to the reply with `text/event-stream`, `cache-control: no-cache, no-transform`, `x-accel-buffering: no` and `connection: close`. It aborts the handler's `@Signal()` when the client goes away.
- **Stopping.** `stop()` (what `app.dispose()` calls) aborts every open stream first, then closes Fastify, which lets in-flight requests finish. Responses sent while stopping carry `connection: close`, so a kept-alive socket doesn't hold the close open.
- **Addresses.** `app.addresses` lists the IPv4 origins Fastify listens on, such as `http://127.0.0.1:41233`.

## Testing

`bootModule({ controllers, provider: FastifyProvider })`, from `@decohere/http/testing`, runs controllers as a real app on this provider, on a free loopback port. This package's own suites, `tests/*.integration.spec.ts`, cover what only the wire shows: compression and static files.
