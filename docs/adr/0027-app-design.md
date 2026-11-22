# 0027. An app is modules by role, each domain cut by subdomain, with one class per concept

- **Status:** Proposed
- **Date:** 2026-11-22

## Context

Decohere said little about how an app's own code is shaped. The architecture page has key patterns (DI, controllers, the unit of work), the style page says "class-centric OOP" but also allows namespace objects and loose functions, and the scaffolder lays an app out flat by kind (`controllers/`, `entities/`, `mappings/`, `repositories/`, `services/`). Nothing said where a domain ends, what may import what, or how a file is named for its role.

Ledger, the largest app on Decohere, worked these rules out while re-laying out its funding module, and wrote them down. They match the design Decohere's own code started with: one job per class, interfaces behind tokens, base classes with abstract parts, named errors, models with behaviour. Two sets of rules for one family of projects would teach two styles, so Decohere adopts ledger's, with the choices below.

## Decision

The picture: [app design](../architecture/app-design.svg).

### Modules by role

- **A module is a bounded context**: a part of the business that changes on its own, with its own words. Each fact has one owner module, and others ask it.
- **A module is up to four projects, named by role:** `<module>.contracts` (what other modules rely on: interfaces, tokens, event shapes, values and DTOs, with no dependencies), `<module>.domain` (everything that decides), `<module>.api` (the edge: HTTP, the database, streams, running processes) and, when it has them, `<module>.tools` (command-line tools kept out of the app image).
- **Dependencies run one way:** contracts ← domain ← api. Another module imports only `*.contracts`, never a domain or api. The app's composition root (`app.ts`) is the only place that sees every module, and binds each contract to its implementation.
- **A new app starts as one module**, with `domain/` and `api/` folders in one project. It splits into projects when a second module needs its contracts, or to break an import cycle; a project exists only to manage dependencies.

### Folders by subdomain, then kind

- **A domain is cut by subdomain first, then by kind:** `entities/`, `values/`, `services/`, `strategies/`, `factories/`, `repositories/`, `events/`, `errors/` and `testing/`, only the kinds it has. A kind folder gets a subfolder only when one thing has several files.
- **An api is cut by kind:** `controllers/`, `mappings/` (the provider's mapping of the domain's entities), `migrations/`, `handlers/` (one per event, named for it), `publishers/`, `processes/` (hosted services) and `testing/`, with `<module>.module.ts` and its config at the root.
- **Each subdomain keeps its user stories** in `stories.md`, and each test names the story it proves.

### One class per concept

- **Every domain concept is one class with one owner.** There is no second `Order`. Its state is private: others ask it questions or tell it to do something. A calculation is a method on the thing it is about.
- **What kinds share is a base class with abstract parts**, not a helper they all import.
- **A service is an interface and a token, implemented by one injected class.** Classes talk through constructor injection or events. No service locator: domain code never calls `container.resolve`. Kinds of a thing are built by their factory, and a consumer is injected every factory registered under one token.
- **Loose functions only for mechanics with no domain meaning** (`sleep`, `backoffMs`). Static `create` and `restore` are fine on entities and values with no dependencies.
- **Crucible's decorators are allowed in the domain** (`@injectable`, `@inject(Token)`): they are metadata, not a vendor.

### Names

- **A file is named for the thing it holds and its role**, one thing per file: `order.entity.ts`, `money.value.ts`, `pricing.service.ts`, `top-carry.strategy.ts`, `carry-algo.factory.ts`, `order.repository.ts`, `venue.port.ts`, `kucoin.adapter.ts`, `order.controller.ts`, `order-placed.handler.ts`, `close-carry.command.ts`, `order-placed.event.ts`, `funds-short.error.ts`, `funding.const.ts`, `order.mapping.ts`, `funding.module.ts`, `funding.config.ts`, `exchange-accounts.contract.ts`, and in `testing/` `orders.repository.cases.ts`.
- **No `utils`, `helpers`, `common`, `shared`, `misc`, `.types.ts`, `.store.ts` or verb-named files.** If a file's name doesn't say what it does, it needs another name or another owner.
- **Errors are named classes ending in `Error`** (`FundsShortError` in `funds-short.error.ts`), thrown and never swallowed. Each becomes a problem response at the edge ([ADR 0025](0025-errors-are-problem-details.md)).
- **Events are past tense, in the owner's words** (`order.placed`), and say what changed by id, not the figures. They are published only after the change is kept, through the unit of work's outbox.
- **Words are the owner's**, never the storage's: series, listing, transaction; not row, record, item.

### Data and tests

- **A repository is one per aggregate root, on `Repository<T>`, in the domain.** The api holds only the provider's mapping. No hand-written in-memory copy: unit tests run the same repository on `@decohere/data-memory`, and Docker tests on the real provider.
- **Tests sit beside the code**: `order.entity.spec.ts` next to `order.entity.ts`. Forge's release build leaves `*.spec.ts` out, and Vitest finds them anywhere. A test goes through the public face of what it tests, from its caller's seat. Every interface with more than one implementation has a `.cases.ts` suite that each passes, and every crossing between modules has a contract test the provider runs.

### Where the rules live

The rules that aren't Decohere's own (all but DI and the data contracts) move to a shared standards repository, `typesmiths/standards`, published as a package each project installs. A project picks up a new version as a dependency update, through its usual pull request and CI, and points its agent instructions at the copy in its own `node_modules`. Rules a tool can check (the import boundaries, file names) ship with the package as checks, so a project that takes the update and breaks a rule fails CI on that pull request.

## Consequences

- A developer can read an app by its file names, and a module's contracts tell another team all it may rely on.
- **Decohere's own code doesn't follow all of this yet.** Its packages use `.types.ts` and a few loose-function files, and keep tests in `tests/`. They move as they are touched; the class-per-job work is tracked on its own. The framework's errors already end in `Error`.
- **Nothing checks the import rules yet.** Until a check exists, review and contract tests keep them; ledger's funding module imports other modules' domains today.
- The scaffolder's template still writes the flat layout; it moves to this one with the checked-in template.
- One more project per module once it splits, and one more package (the standards) every project keeps current.
- Not chosen: a separate application layer of use-case classes. Handlers, controllers and commands orchestrate; the domain decides.
- Not chosen: copying the rules into each repository, or linking to the standards repo's main branch. A copy drifts unnoticed, and an unpinned link changes every project's rules at once with no CI run.

## History

- 2026-11-22: Adopted ledger's rules from its funding module, with errors ending in `Error`, `.entity.ts` for entities, tests beside the code as the rule, and Crucible's decorators allowed in the domain.
