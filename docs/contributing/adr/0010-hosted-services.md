# 0010. Background work runs as hosted services, stopped before the container

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

Apps need work that runs for the life of the app outside a request, such as loading a wallet's history (minutes) and then refreshing it on a timer. With no contract for it, apps started workers from `registerPostBuildStep` and kept them in globals, so timers from the previous Flux boot kept running, and awaiting a long first load kept the app from listening. Separately, TypeORM's `DataSource` has `destroy()` but no `Symbol.asyncDispose`, so stopping the app (and every Flux reboot) left connections open.

## Decision

- **`HostedService`**: `start(signal)`, optional `stop()`, optional `check()`. Registered with `builder.withHostedService(Type)` as a singleton, injectable by its class.
- **`start()` is awaited**, in registration order, before the HTTP server listens. It prepares what must be ready before traffic and returns; long work goes in the background. Not awaiting was rejected: a failed start would go unnoticed, and requests could reach a service that had not started.
- **Or after it listens, when the host has a start budget.** `app.start({ hostedServices: "after-listen" })` listens first, then starts the services in the background, in the same order and one at a time. An app with dozens of services spent over a second of a Cloud Run cold start in them, enough to fail its startup check at random. The guarantee moves rather than goes: `GET /ready` answers 503 while they start, so traffic waits for readiness. The default stays before-listen, so tests and apps that need every service started when `start()` resolves don't change. Starting them side by side was rejected: registration order carries real dependencies (a seed before the feed that reads it), and breaking it would fail quietly.
- **A start that throws is retried, not fatal.** The app logs it, starts the next service, and starts the failed one again in the background with backoff (1 s doubling to 60 s, ±20% jitter, `startRetry` to tune), on the same instance; `GET /ready` fails naming it until it starts. A dependency that is down at start then costs readiness, not a crash loop that stays down after the dependency is back. `startRetry: false` keeps fail-fast, for a one-shot job and for `startTestApp`: a throw stops the services already started and fails `app.start()` (after-listen: it stops the app and rejects `app.hostedServicesStarted()`). Not chosen: retry loops inside each package (a data provider's connection), which would each need their own backoff, logging and readiness.
- **Each start is timed.** `app.hostedServicesStarted()` resolves with `{ name, ms, started }` per service (building it plus its `start()`), in start order, so a slow cold start names its cause.
- **Start steps change the world; building doesn't.** `builder.registerStartStep(step)` runs `step(container)` when the app starts, in registration order, before hosted services and the server. Work that changes things outside the process goes there, such as a provider's `migrateOnStart`, `synchronize` and seed. Building an app only wires it and connects nothing, so a tool or a test that builds it without starting it changes nothing and needs no database; the db commands open the data sources they use themselves (`MigrationTarget.open()`). A step that throws is retried like a service, and holds back everything after it, steps and services, until it succeeds: what follows may need what it does (a database's migrations). With `startRetry: false` it fails `app.start()` before any hosted service starts. A step is not a hosted service because it belongs to a plugin's data, not to a class the container builds, and it has nothing to stop.
- **Data sources connect in a retried start step, not at build.** `typeOrm()` and `mikroOrm()` check their config when the app is built (`auth`, `synchronize`, `migrateOnStart`, a missing bootstrap): a mistake there won't fix itself, so it fails the build rather than being retried. They register each data source unconnected. Their start step (`typeorm data sources`, `mikro-orm data sources`) bootstraps, connects, then migrates, synchronizes and seeds, so an app whose database is down starts, fails `GET /ready`, and serves once the database is back. Until then, resolving a data source's unit of work throws `DependencyUnavailableError` (`@decohere/core/hosting`), which HTTP answers with a 503 problem that keeps the reason (hosts, ports) in the log. Not chosen: connecting at build with a retry loop there, since the app can't answer `/ready` before it is built, and each provider would carry its own backoff.
- **Warm-up is readiness**: a started service that cannot serve yet throws from `check()`, and `GET /ready` answers 503. The other not-ready states are after-listen's "hosted services starting" and a service being retried.
- **Stopping is one path** (`app.dispose()`: stop, SIGTERM/SIGINT, Flux reboot): abort the signal at once (also during a running `start()`), drain HTTP, await each `stop()` in reverse order (after a running `start()` settles; all run even if one throws), then dispose the container. Services stop while what they use is still open.
- **The container closes DataSources**: `typeOrm()` creates a `ManagedDataSource` (with `Symbol.asyncDispose`) and resolves it right after build, so the root container owns it among its first instances and closes it last.
- Hosting lives in `@decohere/core/hosting`, with `Builder` and `App` ([ADR 0014](0014-package-names.md)).

## Consequences

- One contract for background work; Flux reboots no longer leak timers or connections.
- A `start()` that ignores its signal and never returns holds up the stop. On SIGTERM the shutdown timeout (`shutdownTimeoutMs`, default 10 s) exits the process; `app.dispose()` from a test or a reboot waits.
- `typeOrm()` resolves every DataSource at build, still unconnected, so the root container owns it; disposing closes it only if it connected.
- A service that injects a DataSource or MikroORM instance directly, rather than a unit of work, gets it unconnected until the start step has run; hosted services start after it, so they don't see that.
- Hosted services are keyed by class ([ADR 0013](0013-container-keys-and-lifetimes.md)), so same-named classes from different modules are distinct.
- A `start()` that is retried must be safe to call again on the same instance after it threw.
- Not done: restarting a service that fails after it started, per-service stop timeouts, ordering by dependency.

## History

- 2026-10-14: Decided.
- 2026-10-21: Same-named hosted service classes no longer collide, since the container keys services by identity ([ADR 0013](0013-container-keys-and-lifetimes.md)).
- 2026-11-04: `Builder`, `App` and hosted services move to `@decohere/core` rather than a new `@decohere/host` package ([ADR 0014](0014-package-names.md)).
- 2026-11-06: They moved. A worker needs neither `http` nor Fastify.
- 2026-11-06: `withTypeOrm` became the `typeOrm()` plugin ([ADR 0014](0014-package-names.md)).
- 2026-11-08: Start steps added, and the data providers' `synchronize` and seed moved from build to start, with `migrateOnStart` ([ADR 0024](0024-default-orm.md)).
- 2026-11-20: Hosted services may start after the server listens (`hostedServices: "after-listen"`), with `/ready` failing until they have, and each start is timed (`app.hostedServicesStarted()`).
- 2026-11-20: A hosted service whose `start()` throws is retried with backoff while the app serves, rather than failing the start; `startRetry: false` keeps fail-fast.
- 2026-11-20: Start steps are retried too, holding back what follows. The data providers bootstrap and connect in their start step instead of at build, and a request for a data source not connected yet gets a 503 (`DependencyUnavailableError`).
