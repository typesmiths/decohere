# Why Decohere

## The problem

Starting a TypeScript backend is still a research exercise. Before writing anything useful you pick a module format, reconcile `tsconfig.json` with your runtime, and choose a compiler, test runner and dev loop. None of that answers what matters: where source goes, how a package is laid out, what npm expects when you publish, and how development stays consistent with what ships. Each of these decisions comes back at every step: a new package, a cross-cutting concern, a release.

## What Decohere is

One product covering the whole path, from running a single file to shipping a Node API, with one set of conventions.

- **The framework** handles what an API needs: HTTP and routing, dependency injection, configuration, structured logging, auth, data access and health checks. Fastify, Pino, Postgres/TypeORM and Auth0 are defaults, not the contract: vendor code stays at the composition root, so changing a provider isn't a rewrite.
- **The toolchain** handles the lifecycle. [Forge](../projects/forge/README.md) knows the workspace package graph and owns build, typecheck, test, version, publish and Docker. [Flux](../projects/flux/README.md) runs the same sources directly and reloads on change. Both share Forge's SWC compiler and resolve workspace packages to source, so development and release aren't two pipelines.
- **The [scaffolder](../projects/create/README.md)** wires the framework and toolchain into a working app with a Dev Container, Dockerfiles and CI.

Forge and Flux work without the framework: add the [CLI](../projects/cli/) to an existing workspace.

## How it differs

- **[NestJS](https://docs.nestjs.com/)** defines an application model: modules, controllers, providers. Decohere designs the application model, package graph, compiler, tests, dev runtime and release output together.
- **[Nx](https://nx.dev/docs/getting-started/intro)** is broader workspace tooling, with general task orchestration and distributed caching that Decohere doesn't have. Decohere focuses on the path from TypeScript source to a running, released Node API.
- **The dev loop is a product goal.** Packages resolve to source with no prebuild, emit and boot don't wait for a whole-workspace typecheck, and Flux reloads in-process, disposing the previous boot cleanly. Tests prove the program works; typecheck validates the contract before it ships ([testing](testing/#executable-behavior-before-type-contracts)).
