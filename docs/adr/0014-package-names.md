# 0014. Products keep their names; support libraries are named for what they do

- **Status:** Proposed
- **Date:** 2026-10-21 · updated 2026-11-10

## Context

Every package had a codename. A newcomer had to learn a word per package before reading any code, and a glossary was planned to translate them. Nothing has had a public release, so a rename is free now and a breaking change for every user after 0.1.0.

Some of the names are products: people use them directly, type them as commands and talk about them. The rest are libraries underneath that nobody chooses on their own.

## Decision

- **Products keep their names:** `@decohere/forge` (compiler and build CLI), `@decohere/flux` (JIT runner and hot reload), `@decohere/crucible` (dependency injection) and `@decohere/scribe` with its adapters `scribe-pino` and `scribe-console` (logging).
- **A product** is something people use directly and could use without the rest of Decohere, taking only primitives from `core`. Crucible qualifies: every service uses its `@injectable()` / `@inject()`, and from `core` it takes only the metadata helpers, the container interfaces and the `inject` / `optional` parameter markers, which it re-exports.
- **Support libraries are named for what they do:** `@decohere/core`, `@decohere/http` with `@decohere/http-fastify`, `@decohere/config`, `@decohere/data` with `@decohere/data-typeorm`, and `@decohere/workspace`. Directories follow (`projects/core`, `projects/http-fastify`, `projects/data/data`, …).
- **A vendor adapter is its own package, named `<library>-<vendor>`**: `data-typeorm`, `data-mikro-orm`, `scribe-pino`, `http-fastify`. The library holds the contracts and installs no vendor; an app installs the adapter it picks. `@decohere/http` holds controllers, routing, auth, OpenAPI, health, problem details and the `HttpProvider` contract; `FastifyProvider` and the Fastify plugins are in `@decohere/http-fastify`. Settings such as `helmet`, `rateLimit`, `compression`, `cors` and `statics` stay on `HttpSettings`, provider-neutral, and the provider carries them out.
- **Hosting** (`Builder`, `App`, lifecycle, readiness, hosted services) moves from `http` into `core`, not into a new `@decohere/host` package: `core` already holds composition, and `http` depends on it. Hosting there may use only `core`'s container interfaces; Crucible implements them, since Crucible depends on `core`. So `Builder.create()` takes the container builder as an argument, `App` marks its constructor with `inject` and `optional` from `core`, and it starts a generic `AppServer`, which `http`'s provider implements, in place of knowing about HTTP. Features reach `Builder` as plugins, with `builder.use(plugin)`, so `core` knows nothing of them.
- **Exported names say what a thing is**, inside a product too. Scribe keeps `scribe` and `ScribeOptions`, since the logger is the product. Crucible's container is `Container`, its builder `ServiceContainerBuilder` (`ContainerBuilder` is the interface in `core`), its metadata `ContainerMeta`.
- **New packages get plain names** (`devkit`, `testing`: [ADR 0015](0015-core-devkit-testing.md)). A new codename needs a product.

Rejected:

- **Dropping every codename, products included.** `forge` and `flux` are commands people type and recognise; `decohere build` would lose that without being clearer. Scribe is a logging product with its own adapters.
- **A plain name for crucible.** `di` and `ioc` are jargon, `container` reads as Docker in a project that ships images, `composition` names the builder and app lifecycle in `core`, and `inject` names one decorator, not the library.
- **Keeping codenames with a glossary.** It documents the cost instead of removing it, and every new package adds a word.
- **The Fastify provider inside `http`, at a `/providers` subpath.** Every app that used `http` installed Fastify and five plugins, even on another provider, and an app could not leave them out.

## Consequences

- A support library's import says what it does (`@decohere/http`, `@decohere/data`).
- A new package name on npm needs a first publish and a Trusted Publisher before CI can publish it.
- A glossary, if any, only needs the products.

## History

- 2026-10-21: Decided. Crucible stays a product rather than becoming `@decohere/di`.
- 2026-10-22: The CLI base split out of `core` is named `devkit`, not `tooling`, which read as a dumping ground ([ADR 0015](0015-core-devkit-testing.md)).
- 2026-11-04: Hosting (`Builder`, `App`, lifecycle, readiness) moves out of `http` into `core`, not a new `@decohere/host` package: `core` already holds composition and `http` depends on it. The retired names are gone from the docs and code, this record included.
- 2026-11-06: The builder's features are plugins, `builder.use(http(...))`, in place of methods added to `Builder` by side-effect imports. A plugin is a plain function, so forgetting one is a compile error, and nothing runs on import.
- 2026-11-06: Hosting moved, to `@decohere/core/hosting`. `inject`, `optional` and `LifetimeScopeToken` moved to `core/composition` with it, because `App` needs them and `core` can't import Crucible. Crucible re-exports them, so its API is unchanged.
- 2026-11-10: `FastifyProvider` moved out of `http` into its own package, `@decohere/http-fastify`, like `data` and `data-typeorm`, so `http` holds no vendor code. A vendor adapter is a `<library>-<vendor>` package. Not chosen: keeping it at `@decohere/http/providers`, which made every app install Fastify. That subpath stays as a re-export only until the scaffolder imports from the new package.
