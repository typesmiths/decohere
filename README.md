# Decohere

TypeScript framework and toolchain for Node.js backends.

[![CI Main](https://typesmiths.github.io/decohere/badges/ci-main.svg)](https://github.com/typesmiths/decohere/actions/workflows/ci.yml?query=branch%3Amain)
[![CI Release](https://typesmiths.github.io/decohere/badges/ci-release.svg)](https://github.com/typesmiths/decohere/actions/workflows/ci.yml?query=branch%3Arelease)
[![Coverage](https://typesmiths.github.io/decohere/badges/coverage.svg)](https://github.com/typesmiths/decohere/actions/workflows/ci.yml?query=branch%3Arelease)

Decohere takes you from a single TypeScript file to a production Node API without the setup tax. Run a file with no config. Scaffold a complete API with logging, tests, CI and Docker already wired, plus auth and Postgres if you want them. Ship it with the same toolchain that ran it on day one.

One toolchain and one framework, built together. **[Forge](projects/forge/README.md)** builds, tests, versions, containerizes and publishes. **[Flux](projects/flux/README.md)** runs TypeScript straight from source and reloads on save. The framework covers HTTP, dependency injection, config, logging, auth and data, with Fastify, Pino, Postgres and Auth0 as defaults you can swap. Use the whole stack, or add Forge or Flux to the workspace you already have.

[Why Decohere, and how it compares with NestJS and Nx →](docs/why-decohere.md)

## Example: from an empty directory to a deployable API

For a one-off script, install the CLI and run the TypeScript file directly:

```bash
pnpm init
pnpm add -D @decohere/cli
pnpm exec flux run report.ts
```

There is no module-format decision, build step, framework, or scaffold in that path.

When the outcome is a production API instead, start there:

```bash
pnpm create @decohere webapi -d orders
cd orders
pnpm dev
```

That creates more than a controller skeleton. The result has a working package and source layout, configuration and environment conventions, structured logging, health and readiness routes, test setup, linting and typechecking, local HMR, CI, a production build, and Dockerfiles. The scaffolder can also wire Postgres/TypeORM, Auth0, and Postman while it creates the app.

Saving a source file reloads the affected API through [Flux](projects/flux/README.md), including changes in workspace libraries, without prebuilding every dependency. `pnpm build` uses the same compiler pipeline through [Forge](projects/forge/README.md) to emit the production layout consumed by `pnpm start` and the generated Dockerfile.

The acceleration is not one generated file. It is avoiding a separate round of tool selection, layout design, configuration, and integration at every step between the first TypeScript file and a deployable service.

## Getting started

```mermaid
flowchart LR
  existing["Existing TypeScript workspace"] --> source["Your TypeScript source"]
  create["Create<br/>optional complete app"] -.-> source

  source --> flux["Flux<br/>run + HMR"]
  flux --> dev["Development"]

  source --> forge["Forge<br/>build + test + release"]
  forge --> ship["Node · Docker · npm"]

  shared["Workspace graph<br/>+ shared SWC pipeline"]
  shared -.-> flux
  shared -.-> forge
```

Install the CLI to make `forge`, `flux`, and `decohere` available to package scripts and `pnpm exec`:

```bash
pnpm add -D @decohere/cli
```

The [recipes and use cases](docs/recipes/) start at the smallest useful outcome. If you only want to execute a TypeScript file, that is the first recipe and it needs no scaffold, no build step, and no `tsconfig.json` decisions. Publishing a package to npm is the next one. Scaffolding a full API is further down the same path, not a different product.

## Forge

Workspace-aware build and release workflows using [`@decohere/workspace`](projects/workspace/README.md) and SWC. Debug resolves workspace imports to source; release emits the production package shape. Forge also provides typecheck, Vitest, version, publish, Docker, and link workflows.

```bash
pnpm exec forge build
pnpm exec forge build --configuration release
```

Commands and build model: [`@decohere/forge`](projects/forge/README.md).

## Flux

Run TypeScript directly through Forge's compiler—one file with `run`, or a long-lived Node app with `serve` and HMR. No pre-build or Decohere framework required.

```bash
pnpm exec flux run src/main.ts
pnpm exec flux serve
```

Commands and runtime model: [`@decohere/flux`](projects/flux/README.md).

## Scaffold an API

Scaffolding is the optional path to a complete Decohere app. It combines the framework and toolchain, then walks you through database, auth, Postman, and install. The result includes health checks, a Dev Container, production Dockerfiles, and CI. Docker is required to run the scaffolder.

```bash
pnpm create @decohere webapi -d my-app
```

```bash
cd my-app
code .
pnpm build
pnpm dev
```

Options and generated app: [`@decohere/create`](projects/create/README.md).

## Docs

Handbook: **[docs/](docs/)** — architecture, style, testing, contributing, CI, ADRs.

## License

[ISC](LICENSE) © Typesmiths
