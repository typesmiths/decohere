# @decohere/http

HTTP/API platform for Decohere: decorator-based controllers, auth, OpenAPI, health, and a Fastify provider at the edge. Architecture and the provider boundary: [docs/architecture](../../docs/architecture/).

Controllers and services depend on the contracts exported from `@decohere/http`. Fastify stays inside `FastifyProvider`.

The app itself is built with `Builder`, from `@decohere/core/hosting`, on a container from `@decohere/crucible`. This package gives it plugins: `http(provider, settings)` adds the web server, with `health()` and `auth()` beside it, so an app with no web API doesn't need this package.

```ts
import { Builder } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { health, http } from "@decohere/http";
import { FastifyProvider } from "@decohere/http/providers";

await Builder.create(new ServiceContainerBuilder())
	.use(http(FastifyProvider, { controllers: [HelloController] }))
	.use(health())
	.buildAndStart();
```

Everything `http(...)` takes is on `HttpSettings`. `configureHttp(settings)` adds to them from elsewhere, such as a plugin of your own that brings its controllers.

## A web API in one call

`webApi()`, from `@decohere/http/web-api`, adds the parts most APIs start with: the Fastify provider, configuration from YAML files and the environment, Pino logging, `/health` and `/ready`, and an OpenAPI document at `/openapi.json`. A whole app:

```ts
import { Builder } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { webApi } from "@decohere/http/web-api";

export default await Builder.create(new ServiceContainerBuilder(), { applicationName: "orders" })
	.use(webApi({ controllers: [HelloController] }))
	.buildAndStart();
```

What it sets up, and how to change each part:

| Part | Default | Change it with |
|---|---|---|
| HTTP | `http(FastifyProvider, { controllers })` | `provider`, and `http: { globalPrefix, cors, statics, ... }` for anything else `http()` takes |
| Config | `config(new YamlDataSource({ app }), EnvDataSource)`: the files in `config/` if there are any (none is fine), then `SECTION__KEY` variables | `config: [...sources]`, or `false` to add your own `config(...)` |
| Logging | Pino: pretty lines and a rolled `logs/<applicationName>.log` in development, JSON on stdout in production | `logging: { file, level }`; `file: false` writes no file; `false` leaves Scribe alone |
| Probes | `health()` | `health: { checks, underGlobalPrefix }`, or `false` |
| OpenAPI | Titled with the application name, version `1.0.0`; validates requests | `openApi: { info, path, ... }`, or `false` |

`app` names the app in a project with several: it also reads `config.<app>.yaml` and `config.<app>.<NODE_ENV>.yaml`, and one of them must exist ([config](../config/README.md#yaml-files)). Anything else goes on the builder as usual (`.use(auth())`, `.withServices(...)`, `.withHostedService(...)`), and an app that spells every part out with `http(...)`, `config(...)` and `health()` works as before. Logging is set when `webApi()` is applied to the builder, since Scribe is one per process. Why a preset, and why here: [ADR 0026](../../docs/adr/0026-web-api-preset-and-test-helper.md).

## Testing an app

`@decohere/http/testing` starts an app on a free loopback port, so a test calls it over HTTP the way a client would, through routing, auth, validation and the real provider. `await using` stops it at the end of the block.

```ts
import { startTestApp } from "@decohere/http/testing";
import { createApp } from "../src/app.js";

it("says hello", async () => {
	await using api = await startTestApp(createApp());

	const response = await fetch(`${api.baseUrl}/hello`);

	expect(response.status).toBe(200);
});
```

`startTestApp(app)` takes a built app, or the promise `build()` returns. It starts it on `127.0.0.1:0` with no SIGTERM or SIGINT handlers, and gives back `baseUrl`, its origin (such as `http://127.0.0.1:41233`), `app` (its services are at `app.services`), `readEvents` for [streams](#testing-a-stream) and `stop()`. If the app fails to start, it is stopped and the error is thrown.

To test some controllers without the rest of the app (no database, no identity provider), `bootModule` builds an app of only those, with the services you give it:

```ts
import { config, EnvDataSource } from "@decohere/config";
import { bootModule } from "@decohere/http/testing";

it("greets with the configured greeting", async () => {
	vi.stubEnv("SAMPLE__GREETING", "Hi");
	await using api = await bootModule({
		controllers: [HelloController],
		services: (services) => services.registerSingleton(SampleService),
		configure: (builder) => builder.use(config(EnvDataSource)),
	});

	const response = await fetch(`${api.baseUrl}/hello`);

	expect(await response.json()).toEqual({ message: "Hi" });
});
```

To stand in for a service, register an object under its class: `services.registerSingleton(UserService, { ensureFromPrincipal: async () => user })`. A scaffolded app comes with a spec like this, `tests/hello.controller.spec.ts`.

## Serving a built UI

A module can serve its UI's build from its own API: one image, one origin, no CORS.

```ts
Builder.create(new ServiceContainerBuilder()).use(
	http(FastifyProvider, {
		controllers: [PortfolioController],
		statics: [{ prefix: "/ui/", directory: "ui" }], // https://host/ui/ serves ./ui/index.html
	}),
);
```

`directory` is resolved from the folder the app runs in (the process working directory), like `./config`. For a deployable that is `.package/`, where [`forge package`](../forge/README.md#forge-package-one-folder-a-plain-node-can-run) puts the UI (the `ui` declaration there). Call `statics` again to serve more than one UI.

```ts
{
	prefix: "/ui/",
	directory: "ui",
	spaFallback: true,                        // default
	exclude: ["/docs/**"],                    // paths this mount never answers; default none
	index: "index.html",                      // default
	noCache: ["index.html", "remoteEntry.js"], // default
	immutable: /-[A-Za-z0-9_]{8,}\.\w+$/,        // default is a stricter hash pattern; false = never
	cacheControl: "public, max-age=0, must-revalidate", // default, for every other file
	onMissingDirectory: "fail",               // default in production; "warn" in development
}
```

### Rules

- **Public.** Static files are served before the HTTP pipeline: `@Authorize`, tokens, validation and middleware never apply to the prefix, with or without `auth()`. An API route next to it still answers `401`. They are not listed in OpenAPI.
- **Outside the rate limit.** A page load fetches dozens of files, so the API's limit would block ordinary use. Anything that is not served by the static plugin (including a `POST` to the prefix) is limited as usual. Helmet and CORS still apply.
- **Caching.** `index.html` and `remoteEntry.js` (the `noCache` list; a module-federation host loads the remote entry by a fixed name): `Cache-Control: no-cache`. A file whose name carries a content hash, such as `assets/index-DiwrgTda.js` or `style.3f9a8c1b.css` (8 or more letters, digits or `_` after a `-` or `.`, with a digit or a lower-then-upper pair): `public, max-age=31536000, immutable`. Everything else: `public, max-age=0, must-revalidate` with `ETag` and `Last-Modified`, so it is revalidated and answered `304`. `HEAD` and conditional requests work.
- **Client routes.** An unknown path under the prefix (`/ui/portfolio/42`) serves `index.html`, so a reload on a client route works. It decides by what is asking, and serves the app only when **all** of these hold: the method is `GET` or `HEAD`; the path has no extension and no dotfile (`/ui/assets/gone.js` is a real `404`); the `Accept` header includes `text/html` (what a browser sends when it navigates; `application/json` or `*/*` does not count); and the path is not under one of the app's own routes (below). Anything else gets the HTTP package's normal JSON `404`. `/ui` redirects to `/ui/`.
- **Safe paths.** `..` in any encoding cannot leave the directory, dotfiles answer `404`, and a directory is never listed.
- **Safe paths.** `..` in any encoding cannot leave the directory, dotfiles answer `404`, and a directory is never listed.
- **Missing directory.** In production (`NODE_ENV` not `development` or `dev`) the app **fails at start** with the path that is missing. In development it logs a warning and boots, so the API runs before the UI is built; the prefix answers `404` until you restart with the UI built. Set `onMissingDirectory` to choose.
- **Prefix.** The global prefix does not apply to it. Two mounts work, and the more specific prefix wins (`/admin/` over `/`).

### Serving the UI from the root

```ts
Builder.create(new ServiceContainerBuilder())
	.use(
		http(FastifyProvider, {
			controllers: [PortfolioController], // /lp/portfolio, /module/manifest, ...
			statics: [{ prefix: "/", directory: "ui", exclude: ["/docs/**"] }],
		}),
	)
	.use(health());
```

`GET /` serves `index.html`, and so do `GET /portfolio/42` or any other client route a browser opens. The API keeps working because Fastify matches a specific route before the static wildcard; what needed care was an unknown path, where the app is the not-found handler. A request the HTTP package does not hand to the app gets the same JSON `404` as an app without a UI. A mistyped `GET /lp/portfolo` from an API client asks for JSON (or `*/*`), so it never gets HTML with status `200`.

**Under one of the app's own routes.** Without a global prefix, a path is under a registered route when its first segment is the first segment of any controller route, of `/health` and of the OpenAPI document. With a route `/lp/portfolio`, `/lp/portfolo` and `/lp/a/b` are API paths and answer the JSON `404` even to a browser; `/lpx` and `/portfolio` are not, and get the app. A route whose first segment is a parameter (`/:id`) says nothing and is skipped. So a client route cannot start with the same name as an API route.

**With a global prefix** (`globalPrefix: "/api"`) the HTTP package knows where the API lives, so it stops guessing: a path is the API's when it is under the prefix (`/api`, `/api/anything`, not `/apiary`) or at the OpenAPI path, and everything else is the UI's. `/lp/positions` gets the app even if a controller has `/lp/portfolio`, as long as that controller is under the prefix. Routes left out of the prefix (the probes, a controller with `globalPrefix: false`) are the API's too, with every path below them: `/health/x` is a JSON `404`, `/healthy` gets the app. Either way it only limits the fallback: a real file is still served, and a registered route is never shadowed.

**`exclude`.** Patterns for paths the mount never answers, neither a file nor the fallback (the request gets the JSON `404`), for anything the defaults get wrong. They are globs ([picomatch](https://github.com/micromatch/picomatch), `dot` on) matched against the full request path after decoding it and collapsing repeated slashes, not relative to the prefix: `*` is any characters within one segment, `**` crosses segments, `?` is one character. `"/docs/**"` covers `/docs`, `/docs/` and everything below.

Why this shape, and what is left (running the UI's own build): [ADR 0007](../../docs/adr/0007-serving-a-built-ui-from-http.md).

## Global prefix

```ts
Builder.create(new ServiceContainerBuilder())
	.use(
		http(FastifyProvider, {
			controllers: [PortfolioController], // /lp/portfolio -> /api/lp/portfolio
			globalPrefix: "/api",
			statics: [{ prefix: "/", directory: "ui" }],
		}),
	)
	.use(health()); // /health and /ready stay at the root
```

The `globalPrefix` setting puts every **controller route** under the prefix. It does not cover:

- **Static mounts** (`statics`): they have their own prefix.
- **The OpenAPI document**: it keeps its own absolute path (`/openapi.json` by default).
- **A controller that opts out** with `@Controller({ prefix: "/webhooks", globalPrefix: false })`, for paths something outside the app calls at a fixed place: webhooks, metrics.
- **The `/health` and `/ready` probes.** The health controller opts out, because Cloud Run, Kubernetes and most load balancers probe those paths at the root. `health({ underGlobalPrefix: true })` puts them under the prefix instead.

What stays out is decided by the controller, never by matching a path, so a controller of yours that declares `/health` is prefixed like any other.

The prefix is also what the static fallback treats as the API, see [Serving the UI from the root](#serving-the-ui-from-the-root).

## Compression

Responses are compressed with `br` or `gzip`, whichever the client accepts (`Accept-Encoding`), in every environment. Nothing to switch on: the HTTP package registers [`@fastify/compress`](https://github.com/fastify/fastify-compress) with best-practice defaults, and you override them if you need to. The plugin owns the policy; the HTTP package does not re-implement it.

Defaults: on, a 1024-byte threshold, `encodings: ["br", "gzip"]` (no `deflate`), and the plugin's own list of compressible types (text, JSON, XML, `octet-stream`, and anything the MIME database marks compressible). Images, video, woff2 fonts, zip and PDF are not compressed again, and `text/event-stream` is not compressed. A client that sends no `Accept-Encoding` gets the plain body.

```ts
compression: {
	threshold: 2048,                  // bytes, default 1024
	encodings: ["br", "gzip"],        // in order of preference; "deflate" is allowed
	types: /^application\/vnd\.acme/, // see below
	providerOptions: {                // Fastify-specific: any @fastify/compress option, merged last
		brotliOptions: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } },
	},
} }))
```

What to know about the plugin's behaviour:

- **`types` is for adding types.** It is passed as `customTypes`: it replaces the plugin's default pattern, but anything the MIME database marks compressible is still compressed. Do not match `text/event-stream` unless you want streams buffered.
- **The threshold does not apply to streams.** Files served by `statics` are streams, so even a small text file is compressed on the fly. Their `Cache-Control`, `ETag` and `304` behave as before.
- **`application/octet-stream` is compressed by default.** If you serve already-compressed bytes under that type, set the `Content-Type` of the real format or set your own `Content-Encoding`.
- **Server-sent events are not compressed** by the plugin's default pattern, because compression buffers output and events would arrive late. Keep it that way.
- **Unread streamed bodies hold up stopping.** A compressed file stays open until the client has read it, so `app.dispose()` waits for a client that fetched a static file and never read the body. In tests, read or cancel the body (or send `Accept-Encoding: identity`).
- **Already encoded.** A response that sets its own `Content-Encoding` is passed through.
- **`Vary: Accept-Encoding`** is added when a response is compressed.
- **`HEAD`** is answered uncompressed: Fastify builds a `HEAD` reply before the plugin runs, so it has the plain `Content-Length` and no `Vary`. It has no body either way.
- **A `304`** for a file can carry the `Content-Encoding` header of the `200` it stands for. It has no body.
- **Helmet, CORS and the rate limit** are unaffected, and an error reply (a `401`, a `400` with a large body) is compressed like any other.
- **BREACH.** Compressing a response served over HTTPS that contains both a secret and input an attacker controls can leak the secret to someone who can watch response sizes. It mostly concerns HTML that reflects input next to a CSRF token. A JSON API that authenticates with a bearer token in a header is low risk, because the token is not in the body. If you render such pages, mask per-response secrets, do not reflect input beside them, or turn compression off for them.
- **Pre-compressed files.** Serving `.br`/`.gz` files built ahead of time is a possible later step; today static files are compressed on the fly.
- **Testing.** Node's `fetch` negotiates and decodes compression itself. To see what is on the wire, use `node:http` and read the body undecoded.

Why this shape: [ADR 0008](../../docs/adr/0008-response-compression-in-http.md).

## Server-sent events

A controller method can push events to the browser. Mark it `@Sse()`, make it an `async *` method (any `AsyncIterable` works), and yield messages:

```ts
import {
	Authorize,
	Controller,
	Get,
	LastEventId,
	Signal,
	Sse,
	type SseStream,
} from "@decohere/http";
import { setInterval } from "node:timers/promises";

@Controller({ prefix: "/lp" })
class PortfolioController {
	public constructor(private readonly book: PositionBook) {}

	@Authorize("read", "Portfolio")
	@Sse({ heartbeatMs: 15_000 })
	@Get("/portfolio/stream")
	public async *stream(
		@Signal() signal: AbortSignal,
		@LastEventId() lastEventId?: string,
	): SseStream {
		// A browser that reconnects sends the id of the last event it saw. Start after it.
		yield* this.book.replaySince(lastEventId);

		for await (const _ of setInterval(1000, undefined, { signal })) {
			yield { id: String(this.book.version), event: "pnl", data: this.book.snapshot() };
		}
	}
}
```

Browser side: `new EventSource("/lp/portfolio/stream")`. It reconnects by itself and sends `Last-Event-ID`.

### What the HTTP package does

- **Auth first.** The route goes through the same pipeline as any other: `@Authorize`, `@AllowAnonymous`, token checks, request validation and middleware all run before the handler. An unauthorised caller gets a normal `401` or `403` JSON response and no event is ever sent.
- **Format.** Responds `200 text/event-stream`. A yielded string is a `data:` line. A yielded `{ data, event?, id?, retry? }` sets those fields. Non-string `data` is written as JSON, and line breaks in `id` and `event` are removed so a value cannot inject another field.
- **Heartbeats.** After `heartbeatMs` (default 15 s) without an event, the HTTP package writes a `: heartbeat` comment so proxies do not close the idle connection. `heartbeatMs: 0` turns it off.
- **Cancellation.** `@Signal()` gives the handler an `AbortSignal` that aborts when the client disconnects or the app stops. Hand it to whatever the producer waits on (a timer, a subscription, a query). The generator is then stopped and its `finally` blocks run. If the producer ignores the signal, the HTTP package still ends the response, but the producer keeps running until its current `await` finishes.
- **Request scope.** Request-scoped services the controller received stay alive until the stream ends, then are disposed.
- **App stop.** `app.dispose()` (also what Flux calls on a reboot, and what a SIGTERM runs) aborts every open stream and waits for them to end before closing.
- **OpenAPI.** The `200` response is documented as `text/event-stream`, and a `@LastEventId()` argument shows up as the `Last-Event-ID` header parameter.

Why this shape, and what is left for later: [ADR 0005](../../docs/adr/0005-server-sent-events-in-http.md).

### Testing a stream

`@decohere/http/testing` boots your controllers as a real app on a free port and reads events from it:

```ts
import { bootModule } from "@decohere/http/testing";

it("streams the first three prices", async () => {
	await using api = await bootModule({
		controllers: [PriceController],
		services: (c) => c.registerSingleton(PriceFeed),
		configure: (builder) => builder.use(auth()),
	});

	const { status, events } = await api.readEvents("/prices/stream", {
		count: 3,
		headers: { authorization: `Bearer ${token}` },
	});

	expect(status).toBe(200);
	expect(events.map((e) => e.data)).toEqual(["1", "2", "3"]);
});
```

`readEvents` stops and closes the connection after `count` events (default 1). `count: Infinity` reads until the server ends the stream, which is how you test that stopping the app closes it. A non-200 answer returns at once with `status` set and no events, so `401` and `403` are easy to assert. `comments` holds the `:` lines, so heartbeats are visible too. `await using` (or `api.stop()`) stops the app.

## Hosted services

Work that runs for the life of the app, outside any request: a feed that refreshes on a timer, a poller, a queue consumer. Implement `HostedService` and register it:

```ts
@injectable()
export class PositionFeed implements HostedService {
	private warm = false;
	private loading?: Promise<void>;

	public constructor(@inject(PositionBook) private readonly book: PositionBook) {}

	public start(signal: AbortSignal) {
		// Don't wait here: a first load that takes minutes would keep the HTTP server dark.
		this.loading = this.book.loadAll(signal).then(() => {
			this.warm = true;
		});
		const timer = setInterval(() => void this.book.refreshOpen(signal), 60_000);
		signal.addEventListener("abort", () => clearInterval(timer));
	}

	public async stop() {
		await this.loading; // the signal already told it to stop; wait for it to wind down
	}

	public async check() {
		if (!this.warm) throw new Error("positions still loading"); // GET /ready answers 503
	}
}

Builder.create(new ServiceContainerBuilder())
	.use(http(FastifyProvider))
	.use(health())
	.use(typeOrm(lp))
	.withHostedService(PositionFeed);
```

**Starting.** `app.start()` starts hosted services in registration order, and awaits each `start(signal)`, before the HTTP server listens. So a request never reaches a service that hasn't started, and a `start()` that throws fails `app.start()` (the ones already started are stopped). Keep `start()` short: set up what must be ready before traffic, then run long work in the background and return.

**Warming up.** A service that is started but can't serve yet implements `check()`: it throws until the service is ready, and `GET /ready` (`health()`) answers 503 until then. `/health` is unaffected.

**Stopping.** `app.dispose()` runs on `SIGTERM`/`SIGINT` and on every Flux reboot. It:

1. aborts `signal`, at once, also while a `start()` is still running. Clear timers and cancel work on it.
2. lets in-flight HTTP requests finish.
3. awaits each `stop()` in reverse order. If a `start()` was still running, it waits for it first. Every `stop()` runs even if one throws.
4. disposes the container, which closes what the services used (DataSources from `typeOrm()`, anything with `Symbol.asyncDispose`).

`stop()` is optional: a service with nothing to wait for can rely on the signal, or implement `Symbol.asyncDispose`, which step 4 calls. A hosted service is a singleton, so other services and controllers can inject it by its class. Why this shape: [ADR 0010](../../docs/adr/0010-hosted-services.md).
