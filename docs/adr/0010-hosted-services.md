# 0010. Background work runs as hosted services, stopped before the container

- **Status:** Proposed
- **Date:** 2026-10-14 · updated 2026-11-04

## Context

Apps need work that runs for the life of the app outside a request, such as loading a wallet's history (minutes) and then refreshing it on a timer. With no contract for it, apps started workers from `registerPostBuildStep` and kept them in globals, so timers from the previous Flux boot kept running, and awaiting a long first load kept the app from listening. Separately, TypeORM's `DataSource` has `destroy()` but no `Symbol.asyncDispose`, so stopping the app (and every Flux reboot) left connections open.

## Decision

- **`HostedService`**: `start(signal)`, optional `stop()`, optional `check()`. Registered with `builder.withHostedService(Type)` as a singleton, injectable by its class.
- **`start()` is awaited**, in registration order, before the HTTP server listens. It prepares what must be ready before traffic and returns; long work goes in the background. A throw fails `app.start()` after stopping the services already started. Not awaiting was rejected: a failed start would go unnoticed, and requests could reach a service that had not started.
- **Warm-up is readiness**: a started service that cannot serve yet throws from `check()`, and `GET /ready` answers 503. There is no separate "starting" state.
- **Stopping is one path** (`app.dispose()`: stop, SIGTERM/SIGINT, Flux reboot): abort the signal at once (also during a running `start()`), drain HTTP, await each `stop()` in reverse order (after a running `start()` settles; all run even if one throws), then dispose the container. Services stop while what they use is still open.
- **The container closes DataSources**: `withTypeOrm` creates a `ManagedDataSource` (with `Symbol.asyncDispose`) and resolves it right after build, so the root container owns it among its first instances and closes it last.
- Hosting lives in `@decohere/http` (`src/hosting/`, with `Builder` and `App`) for now, and moves with them to `@decohere/core` ([ADR 0014](0014-package-names.md)).

## Consequences

- One contract for background work; Flux reboots no longer leak timers or connections.
- A `start()` that ignores its signal and never returns holds up the stop. On SIGTERM the shutdown timeout (`shutdownTimeoutMs`, default 10 s) exits the process; `app.dispose()` from a test or a reboot waits.
- `withTypeOrm` resolves every DataSource at build. They are already initialised in the pre-build step, so this costs nothing at run time.
- Hosted services are keyed by class ([ADR 0013](0013-container-keys-and-lifetimes.md)), so same-named classes from different modules are distinct.
- Not done: restart on failure, per-service stop timeouts, ordering by dependency.

## History

- 2026-10-14: Decided.
- 2026-10-21: Same-named hosted service classes no longer collide, since the container keys services by identity ([ADR 0013](0013-container-keys-and-lifetimes.md)).
- 2026-11-04: `Builder`, `App` and hosted services move to `@decohere/core` rather than a new `@decohere/host` package ([ADR 0014](0014-package-names.md)).
