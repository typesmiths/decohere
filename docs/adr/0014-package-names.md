# 0014. Products keep their names; support libraries are named for what they do

- **Status:** Proposed
- **Date:** 2026-10-21 · updated 2026-10-22

## Context

Every package had a codename: `nexus`, `crucible`, `cortex`, `protocol`, `codex`, `mesh`, `forge`, `flux`, `scribe`. A newcomer had to learn nine words before reading any code ("crucible" is dependency injection, "cortex" is HTTP), and M7 planned a glossary to translate them. Nothing is published publicly yet, so renaming a package costs nothing now and is a breaking change for every user after 0.1.0.

Some of those names are products: people use them directly, type them as commands and talk about them. The rest are libraries underneath them that nobody chooses on their own.

## Decision

- **Products keep their names:** `@decohere/forge` (compiler and build CLI), `@decohere/flux` (JIT runner and hot reload), `@decohere/crucible` (dependency injection) and `@decohere/scribe` with `@decohere/scribe-pino` (logging).
- **A product** is something people use directly and could use without the rest of Decohere, depending on core for primitives only. Crucible qualifies: every service uses its `@injectable()` / `@inject()`, and from core it takes only the metadata helpers and the container interfaces.
- **Support libraries are named for what they do:**

  | Was | Is |
  |---|---|
  | `@decohere/nexus` | `@decohere/core` |
  | `@decohere/cortex` | `@decohere/http` |
  | `@decohere/protocol` | `@decohere/config` |
  | `@decohere/codex`, `@decohere/codex-typeorm` | `@decohere/data`, `@decohere/data-typeorm` |
  | `@decohere/mesh` | `@decohere/workspace` |

  Directories follow (`projects/core`, `projects/data/data`, …).
- **Exported names say what a thing is**, inside a product too. Scribe keeps `scribe` and `ScribeOptions`, since the logger is the product. Crucible's container is a container: `Crucible` → `Container`, `CrucibleBuilder` → `ServiceContainerBuilder` (`ContainerBuilder` is already the interface in core), `CrucibleMeta` → `ContainerMeta`.
- **New packages get plain names** (`@decohere/host` when hosting moves out of `http`; `@decohere/devkit` and `@decohere/testing`, [ADR 0015](0015-core-devkit-testing.md)). A new codename needs a product.

Rejected:

- **Dropping every codename, products included.** `forge` and `flux` are commands people type and tools they recognise; `decohere build` would lose that without making anything clearer. Scribe is a logging product with its own adapters.
- **A plain name for crucible.** `di` and `ioc` are jargon, `container` reads as Docker in a project that ships images, `composition` is what `@decohere/host` does, and `inject` names one decorator rather than the library.
- **Keeping the codenames with a glossary.** It documents the cost instead of removing it, and every new package adds a word.

## Consequences

- Reading a support library's import tells you what it does (`@decohere/http`, `@decohere/data`).
- Every renamed package is a new name on npm: each needs a first publish and a Trusted Publisher before CI can publish it, and the old dev versions are deprecated.
- Code written against the old names (apps generated earlier, Ledger) has to update its imports.
- Older records, issues and commits still use the old names; the retired-names table in [docs/architecture](../architecture/README.md#appendix--retired-names) maps them.
- The M7 glossary only needs the products.

## History

- 2026-10-21: Decided. Crucible stays a product rather than becoming `@decohere/di`.
- 2026-10-22: The CLI base split out of `core` is named `devkit`, not `tooling`, which read as a dumping ground ([ADR 0015](0015-core-devkit-testing.md)).
