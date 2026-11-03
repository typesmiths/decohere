# 0013. The DI container keys services by identity and checks the graph when it resolves

- **Status:** Proposed
- **Date:** 2026-10-21 · updated 2026-10-21

## Context

The DI container (then `@decohere/crucible`) keyed every registration by a string: a class's `name`, a symbol's description, or the string itself. So:

- Two classes with the same name (two bounded contexts each with a `TokenService`) collided, `Symbol("TokenService")` collided with a class `TokenService`, and minified class names broke injection.
- A missing dependency resolved to `null` with only a log warning. The app failed later, on first use, far from the cause (`Cannot read properties of null`). Optional parameters (`dep?: Foo`) depended on that `null`.
- A dependency cycle overflowed the stack.
- A singleton that depended on a request-scoped service, directly or through a transient, was built once and kept that instance for the life of the process (a *captive dependency*): for example a repository pinning one `QueryRunner` for every request.
- Each `beginScope` copied the whole registration map, so every request paid for every registration.

## Decision

- **Keys match by identity.** A class matches only itself, a symbol only itself, a string only an equal string. A string never matches a class with that name. The builder registers a class under the class, not its name. To inject a class, pass the class: `@inject(SampleService)`, which also keeps its import when the parameter is otherwise only a type.
- **A missing dependency throws** `ResolveError`, naming the chain that needed it (`App → Router → Symbol(AuthorizationService)`). A parameter that may be absent says so with `@optional()`, and receives `undefined` so a default value applies. `resolveMany` still returns `[]`. A parameter whose run-time type is not a class (an interface, an array, or a dropped import shows up as `Object` or `Array`) throws asking for `@inject`, unless it is `@optional()`.
- **Cycles throw** `ResolveError` listing the cycle. The container tracks the registrations being constructed for each resolution, so the check is a lookup on that path.
- **Captive dependencies throw.** Resolving a request-scoped service while a singleton is being constructed (anywhere up the path, through any transients) throws, naming both and the chain. `LifetimeScopeToken` is exempt: a singleton that asks for its scope gets the root container, which is the scope it lives in, and resolves request-scoped services from a scope it begins.
- **A scope looks up through its parent.** Its registry holds only its own `LifetimeScopeToken` and defers everything else to the parent, so beginning a scope does not copy anything.
- The checks run when a service is first resolved, not when the container is built: the container does not walk the whole graph up front.

Rejected:

- **Keeping name keys and detecting collisions.** It would still break under minification, and two contexts would have to rename classes to coexist.
- **Validating the whole graph at `build()`.** Factories (`registerRequestScoped(key, () => …)`) have no declared dependencies, and some services are registered only to be resolved by key; a build-time walk would be partial and could reject valid apps. Resolution-time checks see exactly what is constructed.
- **Treating `dep?: Foo` as optional.** TypeScript erases the `?`, so the container cannot see it; an explicit `@optional()` keeps "may be absent" a visible decision.

## Consequences

- A wiring mistake fails at the first resolve, with the chain in the message, instead of as a `null` dereference later.
- Code that relied on a name match breaks: `@inject("SampleService")` for a class registered as `registerSingleton(SampleService)`. The scaffolder now emits `@inject(SampleService)`. Apps generated earlier need the same change.
- Code that relied on `null` for a missing service must add `@optional()`. `@decohere/http`'s `App` (configuration, HTTP provider, hosted services) and `Router` (authorization service) do.
- Two copies of a package in one process (for example the same library from source and from `node_modules`) register and resolve different classes, so a service registered through one copy is not found through the other. With name keys this worked by accident.
- A singleton that genuinely needs per-request work must take `LifetimeScopeToken` and resolve per request, or become request-scoped.
- Not done: property injection, a `build()`-time graph check, lazy (`() => Token`) keys for genuine cycles.

## History

- 2026-10-21: Decided.
- 2026-10-21: Package names updated to the plain names of [ADR 0014](0014-package-names.md). The decision is unchanged.
