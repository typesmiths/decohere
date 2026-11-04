# 0010. Background work runs as hosted services, stopped before the container

- **Status:** Proposed
- **Date:** 2026-10-14 · updated 2026-11-04

## Context

Apps need work that runs for the life of the app outside a request: ledger's position feed loads a wallet's on-chain history (about 3 minutes for 121 positions) and then refreshes open positions on a timer. With no contract for this, apps started workers from `registerPostBuildStep` and kept them in globals across Flux reboots, so timers from the previous boot kept running. Awaiting a long first load in a post-build step kept the app from listening at all. Separately, TypeORM's `DataSource` has `destroy()` but no `Symbol.asyncDispose`, and nothing resolved it by its token, so stopping the app (and every Flux reboot) left its connections open.

## Decision

- **`HostedService`**: `start(signal)`, optional `stop()`, optional `check()`. Registered with `builder.withHostedService(Type)` as a singleton, so it is injectable by its class.
- **`start()` is awaited**, in registration order, before the HTTP server listens. It sets up what must be ready before traffic and returns; long work goes in the background. A throw fails `app.start()` after stopping the services already started. Not awaiting it was rejected: a failed start would go unnoticed and requests could reach a service that has not started.
- **Warm-up is readiness**: a started service that can't serve yet throws from `check()`, and `GET /ready` answers 503. No separate "starting" state.
- **Stopping is one path** (`app.dispose()`: stop, SIGTERM/SIGINT, Flux reboot): abort the signal at once (also during a `start()` still running), drain HTTP, await each `stop()` in reverse order (after any running `start()` settles; all run even if one throws), then dispose the container. Services stop while what they use is still open.
- **The container closes DataSources**: `withTypeOrm` creates a `ManagedDataSource` (with `Symbol.asyncDispose`) and resolves it right after build, so the root container owns it as one of its first instances and closes it last.
- Lives in `@decohere/http` for now (`src/hosting/`), with `Builder` and `App`; it moves with them to `@decohere/core`.

## Consequences

- One contract for background work, and Flux reboots no longer leak timers or connections.
- A `start()` that ignores its signal and never returns holds up the stop; the shutdown timeout (`shutdownTimeoutMs`, 10s) exits the process on SIGTERM, but `app.dispose()` from a test or a reboot waits.
- `withTypeOrm` resolves every DataSource at build. They were already initialized in the pre-build step, so this costs nothing at runtime.
- Hosted services are keyed by their class ([ADR 0013](0013-container-keys-and-lifetimes.md)), so two hosted service classes with the same name from different modules are distinct.
- Not done: restart on failure, per-service stop timeouts, ordering by dependency rather than registration.

## History

- 2026-10-14: Decided.
- 2026-10-21: Same-named hosted service classes no longer collide, since the container keys services by identity ([ADR 0013](0013-container-keys-and-lifetimes.md)).
- 2026-10-21: Package names updated to the plain names of [ADR 0014](0014-package-names.md). The decision is unchanged.
- 2026-11-04: `Builder`, `App` and hosted services move to `@decohere/core` rather than a new `@decohere/host` package ([ADR 0014](0014-package-names.md)).
