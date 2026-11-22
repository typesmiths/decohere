# @decohere/core

The runtime base every Decohere package builds on. It holds the contracts other packages implement (the container, configuration, the app server) and the app's host: `Builder`, `App` and hosted services. It installs no vendor beyond `reflect-metadata`, and imports `@decohere/scribe` for its own logs.

There is no root entry: `import … from "@decohere/core"` fails. Import a subpath.

## Subpaths

| Subpath | What it holds |
|---|---|
| `@decohere/core/hosting` | `Builder`, `App`, `HostedService`, start steps, readiness checks, `DependencyUnavailableError`, and the `AppServer` contract. See [Hosting](#hosting). |
| `@decohere/core/composition` | The container contract: `ContainerBuilder`, `IContainer`, `LifetimeScope`, `ServiceKey`, `LifetimeScopeToken`, and the `inject` and `optional` parameter decorators. [`@decohere/crucible`](../crucible/README.md) implements it. |
| `@decohere/core/configuration` | The configuration contract: `IConfigurationService` under `ConfigurationServiceToken`, and `IConfigurationDataSource`. Also the config file names (`configFileNames`, `config.{app}.{env}.yaml`). [`@decohere/config`](../config/README.md) implements it. |
| `@decohere/core/reflection` | `Constructable`, `Type` and the `reflect-metadata` helpers (`getMeta`, `defineMeta`, `isConstructable`, …). Importing it loads `reflect-metadata`. |
| `@decohere/core/extensibility` | `Pipeline` and `Step`, `mixwith`, the `extension` decorator, and `FunctionDecorator`, the base of the method decorators. |
| `@decohere/core/caching` | `@cache`, `@memoize` and `@invalidateCache` on methods, over an `ICache` (`MapCache` by default) that `Caching` manages. |
| `@decohere/core/system` | `@retry`, `debounce`, `Subject`, `isDevelopmentEnv`, `lowerCamelCase`, and function types (`Func`, `Action`, `Predicate`). |
| `@decohere/core/collections` | The `collections` namespace: `sumBy`, `mergeBy`, `uniqueObjectsBy`, `findDuplicatesBy`, and a `…ByKey` form of each. |
| `@decohere/core/io` | The `io` namespace: read (also as JSON), write, copy and delete files, remove a folder, check that a file or folder exists, convert between file URLs and paths. |
| `@decohere/core/objects` | `merge`, a deep merge. |

## Contracts other packages implement

- **The container** (`composition`): `ServiceContainerBuilder` and `Container` in [`@decohere/crucible`](../crucible/README.md). `Builder.create` takes one, because core sits below the container that implements it.
- **Configuration** (`configuration`): `ConfigurationService` in [`@decohere/config`](../config/README.md), added with `config(...)`. Without it, `App` uses its defaults (port 3000).
- **The app server** (`hosting`): `AppServer`, registered under `AppServerToken`. [`@decohere/http`](../http/README.md)'s `HttpProvider` extends it, and [`@decohere/http-fastify`](../http-fastify/README.md)'s `FastifyProvider` implements it. An app with no server, a worker, registers none.

## Hosting

An app is built with `Builder` on a container, and plugins add to it:

```ts
import { Builder } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";

const app = await Builder.create(new ServiceContainerBuilder(), { applicationName: "orders" })
	.use(config(YamlDataSource, EnvDataSource))
	.use(http(FastifyProvider, { controllers: [OrderController] }))
	.withServices((services) => services.registerSingleton(OrderService))
	.withHostedService(OrderFeed)
	.build();

await app.start();
```

### `Builder`

- `use(plugin)`: a `BuilderPlugin` is a function that registers what it needs on the builder, such as `http(...)`, `config(...)` or a data provider.
- `withServices(fn)`: register the app's own services on the container builder.
- `withHostedService(...types)`: run [hosted services](#hosted-services) for the life of the app. Each is registered as a singleton.
- `registerStartStep(step, name?)`: work the app does when it starts, before its hosted services, in registration order, such as bringing a database's schema up to date. An app that is only built does none of it.
- `registerPreBuildStep(step)` and `registerPostBuildStep(step)`: work done while building, before the container is built (with the configuration service and the container builder) and after it (with the container).
- `build(type?)`: run the service registrations and pre-build steps, build the container, run the post-build steps, and resolve the `App` (or a subclass). Building connects to nothing. `buildAndStart(type?)` builds, then starts.

### `App`

- `start(options?)`: runs the start steps and hosted services, then starts the `AppServer` if there is one, on `options.port`, else the `api.port` config section (`ApiConfiguration`), else 3000. It returns the server's addresses. Options: `port`, `host`, `shutdownSignals` (default `SIGTERM` and `SIGINT`; `false` to handle them yourself), `shutdownTimeoutMs` (default 10 s, then the process exits with code 1), `hostedServices` (`"before-listen"` or `"after-listen"`) and `startRetry`.
- `hostedServicesStarted()`: resolves with how long each start step and hosted service took, once each has started or is being retried.
- `dispose()`: stops the app. Calling it again, or a signal, returns the same shutdown. `await using` works too (`Symbol.asyncDispose`).
- `services`: the root container, for a tool or a test that builds the app without starting it.
- `addresses`: where the server listens.

### Hosted services


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

**Starting.** `app.start()` starts hosted services in registration order, and awaits each `start(signal)`, before the HTTP server listens. So a request never reaches a service that hasn't started. Keep `start()` short: set up what must be ready before traffic, then run long work in the background and return.

**Starting after the server listens.** A host with a start budget (Cloud Run's startup check, a probe) counts every service's `start()` against it. `hostedServices: "after-listen"` makes the server listen first, then starts the services in the background, in the same order and one at a time, since registration order carries real dependencies (a seed before the feed that reads it):

```ts
await app.start({ port, hostedServices: "after-listen" });
const timings = await app.hostedServicesStarted(); // [{ name: "PositionFeed", ms: 45, started: true }, ...]
```

While they start, `/health` answers 200 and `/ready` answers 503 (`hosted services starting`), so a load balancer that checks readiness sends no traffic to a service that hasn't started.

**A start that throws is retried.** The app doesn't stop for it: it logs the error, starts the next service, and starts the failed one again in the background, after 1 s, doubling to 60 s, each wait varied by ±20%. `/ready` answers 503 until it has started (the anonymous probe gives no detail; the log names the service and its error). A dependency that is down at start, a feed or a broker, then costs readiness, not a crash loop. Start steps are retried the same way, and a failed one holds back every step and service after it: a data provider's step connects to the database and migrates it, so nothing starts against a database that isn't there. A `start()` that is retried runs again on the same instance, so it must be safe to call after it threw. Tune the backoff with `startRetry: { initialMs, maxMs }`.

`startRetry: false` fails fast instead, for a one-shot job that should exit: a throw stops the services already started and fails `app.start()` (after-listen: it stops the app and rejects `hostedServicesStarted()`; await it in `main.ts`, since left unawaited the rejection is unhandled and ends the process). `startTestApp` starts apps this way, so a test sees the error.

`hostedServicesStarted()` works in the default mode too, resolving at once after `start()`. It resolves once each service has started or is being retried: `started: false` marks the second. Each service's time covers building it from the container and its `start()`; the app logs the total at info level and each service at debug.

**Warming up.** A service that is started but can't serve yet implements `check()`: it throws until the service is ready, and `GET /ready` (`health()`) answers 503 until then. `/health` is unaffected.

**Stopping.** `app.dispose()` runs on `SIGTERM`/`SIGINT` and on every Flux reboot. It:

1. aborts `signal`, at once, also while a `start()` is still running. Clear timers and cancel work on it.
2. lets in-flight HTTP requests finish.
3. awaits each `stop()` in reverse order. If a `start()` was still running, it waits for it first. Every `stop()` runs even if one throws.
4. disposes the container, which closes what the services used (DataSources from `typeOrm()`, anything with `Symbol.asyncDispose`).

`stop()` is optional: a service with nothing to wait for can rely on the signal, or implement `Symbol.asyncDispose`, which step 4 calls. A hosted service is a singleton, so other services and controllers can inject it by its class. Why this shape: [ADR 0010](../../docs/adr/0010-hosted-services.md).

`GET /health` and `GET /ready` come from `health()` in [`@decohere/http`](../http/README.md). `/ready` runs each `IReadinessCheck` registered under `ReadinessCheckToken`, and the checks the hosted services give it (`HostedServiceHost.readinessChecks()`).

### `DependencyUnavailableError`

Throw `new DependencyUnavailableError(dependency, reason?)` when something a request needs can't be reached right now, such as a data source still connecting while its start step is retried. `@decohere/http` answers it `503 Service Unavailable` and logs the reason instead of sending it, since it can name hosts.

## Layout and tests

`src/` has one folder per subpath above, each with an `index.ts` that says what it exports. `hosting/` holds `Builder` (`builder.ts`), `App` (`app.ts`), `HostedServiceHost` (`hosted-service-host.ts`), which starts, retries and stops the steps and services, and the tokens in `const.ts`.

There is no canonical suite for core in the [testing table](../../docs/testing/README.md#canonical-suite-ownership). Its own specs, in `tests/`, cover caching, collections, extensibility and system. Hosting is tested through the packages that use it: `projects/http/tests/app.hosted-services.spec.ts`, `app.shutdown.integration.spec.ts`, `app.spec.ts` and `builder.spec.ts` with a web server, and `projects/crucible/tests/hosting/` without one (start steps, a worker). Specs move beside the code, starting with `core` ([ADR 0027](../../docs/adr/0027-code-design.md)).

Some of core doesn't follow ADR 0027 yet: `collections` and `io` are namespace objects of loose functions, and `isDevelopmentEnv`, `ignoreIf` and the method decorators read `process.env` (`NODE_ENV`, `TEST`).
