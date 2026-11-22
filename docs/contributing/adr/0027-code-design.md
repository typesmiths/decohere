# 0027. Decohere's code is one class per job, named for its thing and role, with packages as modules and tests beside the code

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

Decohere started as class-and-interface code: one job per class, interfaces behind tokens, base classes with abstract parts, named errors, models with behaviour. Since agents took over most of the work it has drifted. The style page allows namespace objects and loose functions, and nothing says how a file is named or where a test goes. `pnpm design:check` measured every package on 2026-11-22 and found 853 breaks of the rules below:

- 248 exported loose functions that aren't plugin factories, decorators, `define…` helpers or `is`/`has` predicates;
- 34 namespace objects;
- 21 files with several classes;
- 246 files with no role suffix, and 20 `.types.ts`, `.store.ts` or `utils` files;
- 49 reads of `process.env` outside config and bins;
- all 235 spec files in `tests/` folders, away from their code.

Ledger, the largest app on Decohere, wrote down the rules it builds by while re-laying out its funding module. They are the design Decohere started with, stated fully. Two rule sets for one family of projects would teach two styles, so Decohere adopts ledger's for its own code. The scaffolder then generates apps that follow them.

## Decision

The picture: [code design](../architecture/code-design.svg).

### Packages are modules

- **Each package is a module with one job.** Package names stay as [ADR 0014](0014-package-names.md) set them. No package is split or added for this.
- **A base package holds the contracts, and a provider package implements them** ([ADR 0014](0014-package-names.md) is that rule's home). `data` holds `IUnitOfWork`, `Repository<T>` and `RowStore`, and `data-mikro-orm`, `data-typeorm` and `data-memory` implement them. `http` holds `HttpProvider`, implemented by `http-fastify`; `scribe` holds the facade, implemented by `scribe-pino` and `scribe-console`.
- **Only an app's composition root names a provider.** An app's other code imports base packages.
- Ledger's split of a module into `contracts`, `domain` and `api` projects is for an application. A framework package has no edge of its own, so it doesn't apply here.

### Inside a package: subdomain, then kind

- **Folders are subdomains first** (`http/src/routing`, `auth`, `openapi`; `core/src/caching`, `hosting`; `data/src/tracking`, `migrations`). Inside one, a folder per kind (`decorators/`, `filters/`, `errors/`) once it holds several things of that kind.
- **Each folder has an `index.ts`** that says what the subdomain exports.

### One class per job

- **Everything with state, a lifecycle, more than one implementation, or a rule is a class with one job, named for it.** Its state is private, with read-only getters where others need it. A calculation is a method on the thing it is about.
- **What kinds share is an abstract base class**, not a helper module they all import.
- **A service is an interface and a token, implemented by one injected class.** The token sits beside its interface and is named `<Thing>Token` (`export const ClockToken = Symbol("Clock")`). Classes get what they need through the constructor, never `container.resolve` outside the composition root and the container itself.
- **Loose exported functions are only:**
  - plugin factories (`typeOrm()`, `memory()`);
  - decorators (`@injectable()`);
  - `define…` helpers whose result is data (`defineMigration`, `mapEntity`);
  - `is…`/`has…` predicates (`isDevelopmentEnv`);
  - mechanics with no domain meaning (`sleep`).
  Namespace objects (`export const x = { a, b }`) go: a group of related functions is a class. A `const` typed by a contract (`export const postgres: DatabaseSupport = { … }`) is a value that implements it, not a namespace object.
- **No reads of the process environment in library code.** Config sources and bins read it and pass values in ([architecture §1](../architecture/README.md#1-keep-the-product-pure-of-its-host)).

### Names

- **A file is named for the thing it holds and its role, one thing per file:** `route-path.value.ts`, `memory.plugin.ts`, `optimistic-lock.error.ts`. The roles are `.entity`, `.value`, `.service`, `.strategy`, `.factory`, `.repository`, `.port`, `.adapter`, `.provider`, `.plugin`, `.controller`, `.handler`, `.command`, `.action`, `.decorator`, `.event`, `.error`, `.const`, `.config`, `.module`, `.model`, `.mapping`, `.contract`, `.registry`, `.builder`, `.host`, and `.cases` in `testing/`. A role the list lacks is added here before it is used.
- **The roles that are easy to confuse:** `.contract` is an interface a provider implements, with its token, in the base package. `.provider` is the class that implements a contract, in a provider package. `.adapter` wraps an outside API (a vendor's client, a CLI) behind an interface the package owns. `.port` is an app's interface to something outside it. A package's constants are `<thing>.const.ts`, not a bare `const.ts`.
- **No `utils`, `helpers`, `common`, `shared`, `misc`, `.types.ts`, `.store.ts` or verb-named files.** A type lives beside the thing it describes: in its file, or a `.contract.ts` when it is the contract a provider implements.
- **Interfaces have no `I` prefix**, as in TypeScript's own libraries: `Clock`, not `IClock`. An implementation is named for how it differs (`SystemClock`, `FixedClock`), and the token is `ClockToken`. Eleven interfaces still have the prefix (`IUnitOfWork`, `IContainer`, `ICache`, …); they lose it when their package moves.
- **Errors are named classes ending in `Error`**, one per file (`optimistic-lock.error.ts`), thrown and never swallowed. Decohere's errors already end in `Error`.
- **Entities in an app are `.entity.ts`.** Decohere's own models of the workspace (`project.model.ts`) keep `.model.ts`, since they model files, not a business domain.

### Tests

- **A spec sits beside the file it tests:** `routing/router.spec.ts` next to `routing/router.ts`. Forge's release build leaves `*.spec.ts` out, and Vitest finds specs anywhere. Behaviour suites that span a package (`*.integration.spec.ts`) and Docker suites sit beside the package's `index.ts`, or the subdomain they exercise. `e2e/` stays apart, since it drives built output.
- **Fixtures and test-only helpers** (`__fixtures__/`, `*.cases.ts`, `*.fixtures.ts`, `*.harness.ts`) sit in `src/` only once forge's release build leaves them out; until then they stay in `tests/`.
- A test goes through the public face of what it tests. An interface with several implementations has a `.cases.ts` suite each passes, as the unit-of-work contract does.

### Measured, and only falling

`pnpm design:check` measures the counts above on every pull request, as part of `lint:check`, against a committed baseline. A count that rises fails the check. A count that falls fails too, until the baseline is lowered with `pnpm design:check --update`, so it can't rise back. Existing code moves package by package, each move its own pull request. New code adds no break. A pull request that fixes a break anyway lowers the baseline in the same pull request.

### Apps

The scaffolder generates apps that follow the same rules, and Crucible's decorators are allowed in an app's domain code. An app's own layout (modules split into `contracts`, `domain` and `api`, domains by subdomain then kind) follows ledger's, and is written up when the scaffolder's template is.

### Where the rules live

The rules that aren't Decohere's own move to a shared standards repository, `typesmiths/standards`, published as a package each project installs. A project picks up a new version as a dependency update, through its usual pull request and CI. It points its agent instructions at the copy in its `node_modules`. Rules a tool can check, such as the counts above, ship with the package as checks, so a project that takes the update and breaks a rule fails CI on that pull request.

## Consequences

- Reading a package's file names tells you what it does, and every package reads the same way.
- The move touches most of the code: 235 spec files, about 280 functions and namespace objects, and 266 file names. It goes package by package, starting with `core` and `http`, with the check keeping new code from adding to it.
- Some files are classes for the first time, and a few large ones (`tracking-unit-of-work.ts`, 613 lines) are split by job.
- Not chosen: splitting packages into `contracts`, `domain` and `api` projects. Decohere's base and provider packages already separate contracts from implementations.
- Not chosen: copying the rules into each repository, or linking to the standards repo's main branch. A copy drifts unnoticed, and an unpinned link changes every project's rules at once with no CI run.

## History

- 2026-11-22: Adopted ledger's rules from its funding module for Decohere's own code. Errors end in `Error`, specs sit beside the code, and Crucible's decorators are allowed in an app's domain. Packages stay as they are. The counts are measured in CI and may only fall.
