# Code style

How code is written ([ADR 0027](../adr/0027-code-design.md) says why). New code follows this page. Much existing code doesn't yet: it moves package by package, so copy the [samples](#samples) below, not the nearest file, and check your change against the [do's and don'ts](#dos-and-donts). Package rules: [architecture](../architecture/). Where files go: the [repo map](../README.md#repo-map).

## One class per job

Decohere is **class-centric OOP + Crucible DI**, and SOLID applies to that spine.

- **Everything with state, a lifecycle, more than one implementation, or a rule is a class with one job, named for it.** Its state is private, with read-only getters where others need it. A calculation is a method on the thing it is about.
- **What kinds share is an abstract base class**, not a helper module they all import.
- **A service is an interface and a token, implemented by one injected class.** The token sits beside its interface, named `<Thing>Token`. Dependencies come through the constructor, never `container.resolve` outside the composition root and the container itself.
- **Loose exported functions are only** plugin factories (`typeOrm()`), decorators (`@injectable()`), `define…` helpers whose result is data (`defineMigration`, `mapEntity`), `is…`/`has…` predicates, and mechanics with no domain meaning (`sleep`). A group of related functions is a class, not a namespace object (`export const x = { a, b }`).
- **Existing code moves package by package.** New code adds no break; `pnpm design:check` fails a PR that does. If a PR fixes a break anyway, it lowers the baseline in the same PR: `pnpm design:check --update`.

## Names

Functions do something; everything else is something.

- **Functions and methods are verbs:** `getOwnScript`, `runPackageScript`, `findWorkspaceRoot`, `build`. A predicate asks a question: `isBareSpecifier`, `hasEntry`. A function named like a value (`packageScriptCommand(options)`) reads as one, and the call site no longer says what happens.
- **Everything else is a noun:** classes, types, values and getters. `router.match(...)` reads "router: match"; `project.name` is a property.
- **Interfaces have no `I` prefix:** `Clock`, not `IClock`, as in TypeScript's own libraries. An implementation is named for how it differs (`SystemClock`, `FixedClock`). The `I…` interfaces left in the code lose the prefix when their package moves.
- **Except plugin factories.** A factory whose result goes straight into another tool's plugin list (Vite `plugins`, Astro `integrations`, the builder's `.use()`) is named for what it adds, as that tool's own plugins are: `plugins: [forgeAliases()]`, `.use(mikroOrm({ … }))`. The call site reads as a list of what the app is made of, and a verb (`createForgeAliasesPlugin()`) would stand out from every other plugin beside it.
- **Files are `<thing>.<role>.ts`**, one thing per file: `route-path.value.ts`, `memory.plugin.ts`, `optimistic-lock.error.ts`. The roles and what each means are in the shared standards' table (`node_modules/@decohere/standards/rules/files-and-folders.md`); a missing one is added there first. No `utils`, `helpers`, `common`, `shared`, `misc`, `.types.ts`, `.store.ts` or verb-named files: a type lives beside the thing it describes.
- **Rename when you touch it.** When you change a function with a poor name, rename it in the same PR and update every caller. Anything a package doesn't export can be renamed at any time. Until 1.0, so can what a package exports: Decohere's public surface is small, and its packages are the main callers of each other. After 1.0, renaming an export is a breaking change, so now is the time to fix names.

## Rules

1. ES modules; `.js` extensions in TypeScript import paths.
2. Inside a package, import by relative path. Across packages, import `@decohere/<package>` or one of its `exports` subpaths (`@decohere/core/hosting`), never another package's `src/`.
3. Never `import type` a constructor-injected class. Guide: [`@decohere/crucible`](../../../projects/crucible/README.md).
4. Build outputs under `dist/` (`debug` / `release`).
5. Never silence an error to get past it: no empty `catch`, no error listener that only logs and carries on, no `any` or `@ts-expect-error` to turn a check green.
6. No issue or PR numbers in files: code, tests, docs and ADRs say the reason in words. The code is the source of truth; the link to a discussion lives in the commit and the PR (`Closes #N`).
7. Errors are named classes ending in `Error`, one per file, thrown and never swallowed.
8. No `process.env` in library code ([architecture §1](../architecture/README.md#1-keep-the-product-pure-of-its-host)).
9. Prefer a single `Map` lookup with a null guard over `has` + `get!`: `const value = map.get(key); if (value == null) return;`.

## Do's and don'ts

A starting list, each with the shape to write and the one to avoid. Add one when a review catches the same thing twice.

**Do return early.** Handle the case that ends the function first, so the main path isn't nested.

```ts
// Do
public find(key: string): Route | undefined {
	const route = this.routes.get(key);
	if (route == null) return undefined;
	if (!route.enabled) return undefined;
	return route;
}

// Don't
public find(key: string): Route | undefined {
	if (this.routes.has(key)) {
		const route = this.routes.get(key)!;
		if (route.enabled) {
			return route;
		}
	}
	return undefined;
}
```

**Don't declare with `var`.** Use `const`, and `let` only when the value is reassigned.

```ts
// Do
const port = config.port ?? 3000;

// Don't
var port = config.port || 3000;
```

**Don't export a loose function for work that belongs to a thing.** Put it on the class it is about, or make a class whose job it is. Loose functions are only the kinds [above](#one-class-per-job).

```ts
// Do: route-path.value.ts
export class RoutePath {
	public constructor(private readonly value: string) {}

	public join(child: string): RoutePath {
		return new RoutePath(`${this.value}/${child}`.replace(/\/+/g, "/"));
	}
}

// Don't: route-path.ts
export function joinRoutePath(parent: string, child: string): string {
	return `${parent}/${child}`.replace(/\/+/g, "/");
}
```

**Don't write a utility class or a namespace object.** A class of static methods, or `export const x = { a, b }`, groups functions by how they look, not what they are about. Each method goes on the class it works on; if none exists, that class is missing.

```ts
// Do: each on its own thing
export class ProjectName { /* parse(), toScope() */ }
export class PackageVersion { /* bump(), isPrerelease() */ }

// Don't: string.utils.ts
export class StringUtils {
	public static toScope(name: string): string { /* … */ }
	public static bumpVersion(version: string): string { /* … */ }
}
```

**Do take what a class needs through its constructor.** Don't reach for the container, a module-level singleton or `process.env` inside it: a test then has to know what the class secretly reads.

```ts
// Do
@injectable()
export class ReportService {
	public constructor(@inject(ClockToken) private readonly clock: Clock) {}
}

// Don't
export class ReportService {
	private readonly clock = container.resolve<Clock>(ClockToken);
	private readonly debug = process.env.DEBUG === "1";
}
```

**Do throw a named error.** Don't throw a string or a bare `Error` a caller can only tell apart by its message.

```ts
// Do
throw new RouteConflictError(path);

// Don't
throw new Error(`route ${path} already exists`);
```

## Samples

Short, complete shapes to copy. Each names its file.

**A contract, and a service that depends on it.** The interface and its token share a file; the service gets the interface through its constructor.

```ts
// clock.contract.ts
export interface Clock {
	now(): Date;
}
export const ClockToken = Symbol("Clock");

// order-expiry.service.ts
import { inject, injectable } from "@decohere/crucible/decorators";
import { type Clock, ClockToken } from "./clock.contract.js";

@injectable()
export class OrderExpiryService {
	public constructor(@inject(ClockToken) private readonly clock: Clock) {}

	public isExpired(order: { expiresAt: Date }): boolean {
		return order.expiresAt < this.clock.now();
	}
}
```

**The spec beside it.** It tests through the public face, with a small class standing in for the contract.

```ts
// order-expiry.service.spec.ts
import { describe, expect, it } from "vitest";
import type { Clock } from "./clock.contract.js";
import { OrderExpiryService } from "./order-expiry.service.js";

class FixedClock implements Clock {
	public constructor(private readonly at: Date) {}
	public now() {
		return this.at;
	}
}

describe("OrderExpiryService", () => {
	it("calls an order expired once its time has passed", () => {
		const expiry = new OrderExpiryService(new FixedClock(new Date("2026-11-22T10:00:00Z")));
		expect(expiry.isExpired({ expiresAt: new Date("2026-11-22T09:00:00Z") })).toBe(true);
	});
});
```

**A named error.** One class per file, its `name` set, the cause passed through. From [`dependency-unavailable.error.ts`](../../../projects/core/src/hosting/dependency-unavailable.error.ts):

```ts
// dependency-unavailable.error.ts
export class DependencyUnavailableError extends Error {
	public override readonly name = "DependencyUnavailableError";

	public constructor(
		public readonly dependency: string,
		reason?: string,
		options?: ErrorOptions,
	) {
		super(reason == null ? `${dependency} is unavailable` : `${dependency} is unavailable: ${reason}`, options);
	}
}
```

**A plugin factory.** A loose function the builder's `.use()` takes, named for what it adds. It registers what it needs and does nothing on import. From [`memory.plugin.ts`](../../../projects/data/data-memory/src/memory.plugin.ts):

```ts
// memory.plugin.ts
export function memory(config: MemoryModuleConfig): BuilderPlugin {
	return (builder) => {
		builder.withServices((containerBuilder) => {
			const store = new MemoryStore(config.entities);
			containerBuilder.registerRequestScoped(
				DEFAULT_DATA_SOURCE,
				() => new TrackingUnitOfWork(new MemoryRowStore(store)),
			);
		});
	};
}
```

**A provider implementing a base package's contract.** The provider package imports the base package; the base package never imports it. `FastifyProvider` in [`fastify.provider.ts`](../../../projects/http-fastify/src/fastify.provider.ts) implements `HttpProvider` from `@decohere/http`:

```ts
// fastify.provider.ts, in @decohere/http-fastify
import type { HttpProvider } from "@decohere/http";

@injectable()
export class FastifyProvider implements HttpProvider {
	/* … */
}
```

**Code that needs the environment** takes it as a value. The bin or config source reads `process.env` and passes it in:

```ts
// static-mount.service.ts (library): no process.env here
export class StaticMountService {
	public constructor(private readonly development: boolean) {}
}

// main.ts (the app's entry): reads the environment once
const development = process.env.NODE_ENV === "development";
```

More shapes live with their package: a repository and a migration in [`@decohere/data`](../../../projects/data/data/README.md), a hosted service in [`@decohere/core`](../../../projects/core/README.md), a config section in [`@decohere/config`](../../../projects/config/README.md).
