# 0010. Background work runs as hosted services, stopped before the container

- **Status:** Proposed
- **Date:** 2026-10-14 · updated 2026-11-20

## Context

Apps need work that runs for the life of the app outside a request, such as loading a wallet's history (minutes) and then refreshing it on a timer. With no contract for it, apps started workers from `registerPostBuildStep` and kept them in globals, so timers from the previous Flux boot kept running, and awaiting a long first load kept the app from listening. Separately, TypeORM's `DataSource` has `destroy()` but no `Symbol.asyncDispose`, so stopping the app (and every Flux reboot) left connections open.

## Decision

- **`HostedService`**: `start(signal)`, optional `stop()`, optional `check()`. Registered with `builder.withHostedService(Type)` as a singleton, injectable by its class.
- **`start()` is awaited**, in registration order, before the HTTP server listens. It prepares what must be ready before traffic and returns; long work goes in the background. A throw fails `app.start()` after stopping the services already started. Not awaiting was rejected: a failed start would go unnoticed, and requests could reach a service that had not started.
- **Or after it listens, when the host has a start budget.** `app.start({ hostedServices: "after-listen" })` listens first, then starts the services in the background, in the same order and one at a time. An app with dozens of services spent over a second of a Cloud Run cold start in them, enough to fail its startup check at random. The guarantees move rather than go: `GET /ready` answers 503 while they start, so traffic waits for readiness, and a throw stops the app and rejects `app.hostedServicesStarted()`, whose rejection ends the process if `main.ts` doesn't await it. The default stays before-listen, so tests and apps that need every service started when `start()` resolves don't change. Starting them side by side was rejected: registration order carries real dependencies (a seed before the feed that reads it), and breaking it would fail quietly.
- **Each start is timed.** `app.hostedServicesStarted()` resolves with `{ name, ms }` per service (building it plus its `start()`), in start order, so a slow cold start names its cause.
- **Start steps change the world; building doesn't.** `builder.registerStartStep(step)` runs `step(container)` when the app starts, in registration order, before hosted services and the server. Work that changes things outside the process goes there, such as a provider's `migrateOnStart`, `synchronize` and seed. Building an app only wires and connects it, so a tool or a test that builds it without starting it (the db commands, through `app.services`) changes nothing. A step that throws fails `app.start()` before any hosted service starts. A step is not a hosted service because it belongs to a plugin's data, not to a class the container builds, and it has nothing to stop.
- **Warm-up is readiness**: a started service that cannot serve yet throws from `check()`, and `GET /ready` answers 503. The only other not-ready state is after-listen's "hosted services starting".
- **Stopping is one path** (`app.dispose()`: stop, SIGTERM/SIGINT, Flux reboot): abort the signal at once (also during a running `start()`), drain HTTP, await each `stop()` in reverse order (after a running `start()` settles; all run even if one throws), then dispose the container. Services stop while what they use is still open.
- **The container closes DataSources**: `typeOrm()` creates a `ManagedDataSource` (with `Symbol.asyncDispose`) and resolves it right after build, so the root container owns it among its first instances and closes it last.
- Hosting lives in `@decohere/core/hosting`, with `Builder` and `App` ([ADR 0014](0014-package-names.md)).

## Consequences

- One contract for background work; Flux reboots no longer leak timers or connections.
- A `start()` that ignores its signal and never returns holds up the stop. On SIGTERM the shutdown timeout (`shutdownTimeoutMs`, default 10 s) exits the process; `app.dispose()` from a test or a reboot waits.
- `typeOrm()` resolves every DataSource at build. They are already initialised in the pre-build step, so this costs nothing at run time.
- Hosted services are keyed by class ([ADR 0013](0013-container-keys-and-lifetimes.md)), so same-named classes from different modules are distinct.
- Not done: restart on failure, per-service stop timeouts, ordering by dependency.

## History

- 2026-10-14: Decided.
- 2026-10-21: Same-named hosted service classes no longer collide, since the container keys services by identity ([ADR 0013](0013-container-keys-and-lifetimes.md)).
- 2026-11-04: `Builder`, `App` and hosted services move to `@decohere/core` rather than a new `@decohere/host` package ([ADR 0014](0014-package-names.md)).
- 2026-11-06: They moved. A worker needs neither `http` nor Fastify.
- 2026-11-06: `withTypeOrm` became the `typeOrm()` plugin ([ADR 0014](0014-package-names.md)).
- 2026-11-08: Start steps added, and the data providers' `synchronize` and seed moved from build to start, with `migrateOnStart` ([ADR 0024](0024-default-orm.md)).
- 2026-11-20: Hosted services may start after the server listens (`hostedServices: "after-listen"`), with `/ready` failing until they have, and each start is timed (`app.hostedServicesStarted()`).
