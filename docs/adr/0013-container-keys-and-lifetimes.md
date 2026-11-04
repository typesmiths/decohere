# 0013. The DI container keys services by identity and checks the graph when it resolves

- **Status:** Proposed
- **Date:** 2026-10-21

## Context

Crucible's container keyed every registration by a string: a class's `name`, a symbol's description, or the string itself. So:

- Two classes with the same name (a `TokenService` in each of two bounded contexts) collided, `Symbol("TokenService")` collided with a class `TokenService`, and minified class names broke injection.
- A missing dependency resolved to `null` with a log warning, and the app failed later, far from the cause. Optional parameters (`dep?: Foo`) relied on that `null`.
- A dependency cycle overflowed the stack.
- A singleton depending on a request-scoped service, directly or through a transient, kept one instance for the life of the process (a *captive dependency*), e.g. a repository pinning one `QueryRunner` for every request.
- Each `beginScope` copied the whole registration map, so every request paid for every registration.

## Decision

- **Keys match by identity.** A class matches only itself, a symbol only itself, a string only an equal string; a string never matches a class of that name. The builder registers a class under the class. To inject a class, pass it: `@inject(SampleService)`, which also keeps its import when the parameter is otherwise only a type.
- **A missing dependency throws** `ResolveError`, naming the chain that needed it (`App → Router → Symbol(AuthorizationService)`). A parameter that may be absent says so with `@optional()` and receives `undefined`, so a default value applies. `resolveMany` still returns `[]`. A parameter whose run-time type is not a class (an interface, an array, a dropped import: `Object` or `Array`) throws asking for `@inject`, unless it is `@optional()`.
- **Cycles throw** `ResolveError` listing the cycle. The container tracks what it is constructing on each resolution path, so the check is a lookup.
- **Captive dependencies throw.** Resolving a request-scoped service while a singleton is being constructed (anywhere up the path) throws, naming both and the chain. `LifetimeScopeToken` is exempt: a singleton asking for its scope gets the root container and resolves request-scoped services from a scope it begins.
- **A scope looks up through its parent.** It holds only its own `LifetimeScopeToken`, so beginning one copies nothing.
- Checks run when a service is first resolved, not when the container is built.

Rejected:

- **Name keys plus collision detection.** Still breaks under minification, and two contexts would have to rename classes to coexist.
- **Validating the whole graph at `build()`.** Factories (`registerRequestScoped(key, () => …)`) declare no dependencies, and some services are only resolved by key, so a build-time walk would be partial and could reject valid apps.
- **Treating `dep?: Foo` as optional.** TypeScript erases the `?`; an explicit `@optional()` keeps "may be absent" a visible decision.

## Consequences

- A wiring mistake fails at the first resolve, with the chain in the message, instead of as a `null` dereference later.
- `@inject("SampleService")` no longer finds a class registered as `registerSingleton(SampleService)`. The scaffolder emits `@inject(SampleService)`.
- Code that relied on `null` for a missing service needs `@optional()`, as `App` (configuration, HTTP provider, hosted services) and `Router` (authorization service) have.
- Two copies of a package in one process (from source and from `node_modules`) register different classes, so a service registered through one is not found through the other.
- A singleton that needs per-request work takes `LifetimeScopeToken` and resolves per request, or becomes request-scoped.
- Not done: property injection, a `build()`-time graph check, lazy (`() => Token`) keys for genuine cycles.

## History

- 2026-10-21: Decided.
