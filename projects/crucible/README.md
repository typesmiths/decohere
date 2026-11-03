# @decohere/crucible

Lightweight dependency injection for Decohere. Register classes (or tokens) on a `ServiceContainerBuilder`, `build()` a container, then `resolve()` graphs of constructor-injected services.

Higher layers (for example `@decohere/http`'s `Builder.withServices`) register on a `ServiceContainerBuilder`. You can also build and resolve from a container yourself.

## When to use

| Use `@decohere/crucible` | Do not use it |
|---|---|
| Constructor-injected services and controllers | Replacing the HTTP, config or data packages — those compose *on top of* the container |
| Tokens for interfaces, config objects, and “many of this kind” | Auto-scanning folders or Nest-style modules (not in this package) |
| Request / singleton / transient lifetimes and `using` disposal | Compile-time graph checking (the graph is checked when a service is first resolved) |

## Install

```bash
pnpm add @decohere/crucible
```

```ts
import { ServiceContainerBuilder, LifetimeScopeToken, Scopes } from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";
```

Decorator metadata is required. Enable it in `tsconfig.json` (the Decohere scaffold and this repo already do):

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

`@decohere/core/reflection` loads `reflect-metadata`. Import `@decohere/crucible` (or `@decohere/core`) before constructing decorated classes.

---

## Constructor injection — `@inject` is usually unnecessary

If the constructor parameter is a **concrete class**, the container reads `design:paramtypes` and resolves that class. Mark the *consumer* `@injectable()` so TypeScript/SWC emit that metadata. Do **not** add `@inject` for that parameter.

```ts
import { injectable } from "@decohere/crucible/decorators";
import { SampleService } from "./sample.service.js";

@injectable()
export class HelloController {
  public constructor(private readonly sample: SampleService) {}
}
```

```ts
import { ServiceContainerBuilder } from "@decohere/crucible";

const builder = new ServiceContainerBuilder();
builder.registerSingleton(SampleService);
builder.registerRequestScoped(HelloController);
const container = builder.build();

using scope = container.beginScope("req");
const hello = scope.resolve(HelloController);
```

`@injectable()` is an empty class decorator. Its job is to force `design:paramtypes` onto the constructor. Any other class decorator (`@Controller()`, `@Trace`, …) also does that; `@injectable()` is the one to use when there is nothing else.

### Do not `import type` injected classes

`import type` is erased at compile time. `emitDecoratorMetadata` then records `Object` (or nothing) instead of the constructor. The container cannot tell what to inject and **throws `ResolveError`** when the consumer is resolved, naming the parameter and telling you to add `@inject`.

```ts
// Wrong — SampleService does not exist at runtime, paramtypes collapse to Object
import type { SampleService } from "./sample.service.js";

// Right — value import keeps the constructor for reflect-metadata
import { SampleService } from "./sample.service.js";
```

`import type` is correct for **interfaces** and type-only helpers. Those have no runtime constructor; pair them with `@inject(token)` (see below).

Linters that prefer type-only imports (`import type` / `import { type X }`) will flag a class that appears unused except as a constructor type. Keep the value import and suppress that rule locally — for example with oxlint (or Biome, or ESLint):

```ts
// oxlint-disable-next-line typescript/consistent-type-imports -- constructor injection needs the class at runtime
import { Workspace } from "@decohere/workspace";
```

That pattern is used throughout Forge (`Build`, `Clean`, …). Same idea applies to ESLint `consistent-type-imports` or equivalent.

---

## When you *do* need `@inject`

`@inject(key)` overrides the paramtypes lookup with an explicit key: a class constructor, string, or symbol. Use it when there is no useful constructor in `design:paramtypes`.

| Situation | Why `@inject` |
|---|---|
| Interface or type alias (`ISampleStore`) | No runtime class; paramtypes is `Object` |
| String / symbol token | The service is registered under the token, not the class |
| Array of implementations (`Transformer[]`) | Paramtypes is `Array`, which says nothing about the element type |
| Paramtypes collapsed to `Object` (the class's import was dropped) | `@inject(TheClass)` uses the class as a value, so its import is kept |

```ts
import { inject, injectable } from "@decohere/crucible/decorators";

export const SampleStoreToken = Symbol("SampleStore");

export interface ISampleStore {
  get(id: string): Promise<unknown>;
}

@injectable()
export class SampleService {
  public constructor(
    @inject(SampleStoreToken) private readonly store: ISampleStore,
  ) {}
}
```

Keep tokens in a `const.ts` (or next to the interface). Register against the same token:

```ts
builder.registerSingleton(SampleStoreToken, PostgresSampleStore);
// or an already-built instance:
builder.registerSingleton(SampleStoreToken, store);
```

`@inject` takes `string | symbol | Constructable`. To inject a class, pass the class: `@inject("SampleService")` does **not** find `SampleService` (see [Keys](#registration-and-lifetimes)). Arrays use `resolveMany` automatically when the reflected type is `Array`. For a dependency that may be absent, add `@optional()` (see [Optional / missing](#optional--missing-dependencies)).

---

## Registration and lifetimes

Keys match by **identity** ([ADR 0013](../../docs/adr/0013-container-keys-and-lifetimes.md)): a class matches only itself, a symbol only itself, a string only an equal string. So `resolve("SampleService")` does not find `registerSingleton(SampleService)`, `Symbol("TokenService")` does not collide with a class `TokenService`, two classes with the same name in different modules stay apart, and minified class names still work.

Registering the same class (or the same type on a token) twice **throws** `RegistrationError` — silent last-wins hides accidental double-registers. Replace it explicitly:

```ts
builder.override.registerSingleton(SampleService);
builder.override.registerTransient(SampleService);
```

`builder.override` is a registrar with replace already bound — the builder itself is not mutated. Two different types on one token is still multi-bind: `resolve` throws `ResolveError`, `resolveMany` returns both.

| Lifetime | Cached |
|---|---|
| Singleton | On the root container — shared with every nested scope |
| Request | On the current scope — new instance per `beginScope` |
| Transient | Never — new instance every `resolve` |

A singleton may not depend on a request-scoped service, directly or through transients: it would keep the first request's instance forever (a "captive dependency", e.g. one database connection for the life of the process). Resolving one throws `ResolveError` naming the chain. Make the consumer request-scoped, or inject `LifetimeScopeToken` and resolve the request-scoped service per request. `LifetimeScopeToken` itself is allowed: a singleton gets the root container.

A dependency cycle (`A → B → A`) throws `ResolveError` listing the cycle.

```ts
builder.registerSingleton(SampleService);
builder.registerSingleton(Token, SampleService);
builder.registerSingleton(Token, existingInstance);

builder.registerRequestScoped(HelloController);
builder.registerRequestScoped(Token, HelloController);
builder.registerRequestScoped(Token, () => createConnection());

builder.registerTransient(Helper);
builder.registerTransient(Token, Helper);
```

`registerType(type, scope?)` and `registerTypes(...)` are the same registrations without the lifetime in the method name (default **transient**). `Scopes.singleton` is the string `"single-instance"`.

HTTP (`@decohere/http`): controllers are **request-scoped** (one per request). Services are usually **singletons**.

`registerSingleton(Class, instance)` binds an existing object under the class. The CLI does this for the workspace:

```ts
builder.registerSingleton(workspace.constructor, workspace);
```

---

## Recipes

### Many implementations of one token

Register several types under the same token. Inject them as an array with `@inject(Token)`.

```ts
export const TransformerKey = Symbol("TransformerKey");

builder.registerSingleton(TransformerKey, SwcTranspiler);
builder.registerSingleton(TransformerKey, TypeEmitter);
```

```ts
@injectable()
export class Build {
  public constructor(
    @inject(TransformerKey) private readonly transformers: Transformer[],
  ) {}
}
```

`resolve(TransformerKey)` **throws** `ResolveError` when more than one registration exists. Use `resolveMany(TransformerKey)` or constructor injection of an array.

### Request scopes and disposal

```ts
builder.registerRequestScoped(UnitOfWork);
builder.registerSingleton(Clock);
const container = builder.build();

{
  using scope = container.beginScope("req-1");
  const uow = scope.resolve(UnitOfWork); // per-scope
  const clock = scope.resolve(Clock); // same singleton as the root
} // scope[Symbol.dispose]() — request-scoped instances are disposed

await using scope = container.beginScope("req-2");
// async teardown via Symbol.asyncDispose if the instance implements it
```

- Child scopes look registrations up in their parent (nothing is copied, so `beginScope` costs the same however many services are registered); they do not share the request-instance cache.
- Nested `beginScope` is allowed; each level has its own request instances.
- Named scopes: a live duplicate name throws `DuplicateScopeError`. After dispose, the name can be reused. Unnamed scopes do not collide.
- Disposing a parent does **not** dispose child scopes. Dispose the scope you created.
- Singletons are cached on the root container and shared with nested scopes. Resolving a singleton after the root is disposed throws.

`App.dispose` (`@decohere/http`) (Flux HMR / SIGINT) disposes the **root** container, then Scribe. Implement `Symbol.asyncDispose` (or `Symbol.dispose`) on long-lived services — sockets, pools, timers. Only **constructed** instances are disposed (resolve them at boot; transients are not cached). `export default app` is the composition-root contract; do not wrap it for extra teardown.

The current scope is always registered as `LifetimeScopeToken`:

```ts
import { type LifetimeScope, LifetimeScopeToken } from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";

@injectable()
export class ExceptionFilterHost {
  public constructor(
    @inject(LifetimeScopeToken) private readonly scope: LifetimeScope,
  ) {}
}
```

### Factories

```ts
builder.registerRequestScoped("connection", () => createConnection());
const connection = container.resolve("connection");
```

Arrow factories are called as functions (not `new`). Use them when construction needs arguments the container should not know about.

### Optional / missing dependencies

A missing registration **throws** `ResolveError`, naming the chain that needed it (`App → Router → Symbol(AuthorizationService)`). `resolveMany` returns `[]` instead. A `?` on the parameter type does not make it optional to the container; add `@optional()`, and the container passes `undefined` (so a default value applies):

```ts
import { inject, injectable, optional } from "@decohere/crucible/decorators";

@injectable()
export class App {
  public constructor(
    @inject(HttpProviderToken) @optional() private readonly http?: HttpProvider,
  ) {}
}
```

### HTTP apps

```ts
import { Builder } from "@decohere/http";
import { FastifyProvider } from "@decohere/http/providers";
import { SampleService } from "./services/sample.service.js";
import { HelloController } from "./controllers/hello.controller.js";

await Builder.create()
  .withHttp(FastifyProvider)
  .withControllers(HelloController)
  .withServices((cb) => {
    cb.registerSingleton(SampleService);
  })
  .buildAndStart();
```

`withHttp` / `withControllers` already register the HTTP stack (router, controllers as request-scoped, …). Application services go in `withServices`.

### Tests

Prefer constructing the subject with explicit fakes when you do not need the container. Use `ServiceContainerBuilder` when the test *is* the wiring (scopes, tokens, many-implementations).

```ts
const builder = new ServiceContainerBuilder();
builder.registerSingleton(SampleService, fakeSample);
builder.registerRequestScoped(HelloController);
const container = builder.build();
using scope = container.beginScope("test");
const hello = scope.resolve(HelloController);
```

To assert constructor arguments under DI, use `spyOnConstructor` from `@decohere/testing` — a bare `vi.spyOn` / `vi.fn` constructor drops `design:paramtypes`. See [Asserting DI constructor arguments](../../docs/testing/how-tos/vitest-constructor-spy-with-di.md).

---

## Public API

### `@decohere/crucible`

| Export | Role |
|---|---|
| `ServiceContainerBuilder` | Fluent registration; `build()` → `Container` |
| `Container` | The container: `resolve`, `resolveMany`, `beginScope`, `Symbol.dispose` / `Symbol.asyncDispose` |
| `IContainer` / `LifetimeScope` / `ContainerBuilder` / `ServiceProvider` | Composition interfaces |
| `Scopes` | `{ request, singleton: "single-instance", transient }` |
| `LifetimeScopeToken` | Symbol for the current scope |
| `ResolveError` | Nothing registered, several registrations for `resolve`, a cycle, a captive dependency, or a parameter with no usable type |
| `DuplicateScopeError` | `beginScope` with a live duplicate name |
| `RegistrationError` | Same type registered twice without `builder.override` |

### `@decohere/crucible/decorators`

| Export | Role |
|---|---|
| `injectable()` | Empty class decorator; emit `design:paramtypes` |
| `inject(key)` | Parameter decorator; resolve this key instead of the reflected type |
| `optional()` | Parameter decorator; pass `undefined` when nothing is registered instead of throwing |

---

## Pitfalls

1. **`import type` on an injected class** — paramtypes become `Object` → `ResolveError` asking for `@inject`. Use a value import, or `@inject(TheClass)`.
2. **Missing `@injectable()` (or any decorator) on the consumer** — no paramtypes, constructor is called with zero arguments.
3. **`resolve` of a multi-bound token** — throws; use `resolveMany` or inject `T[]` with `@inject(token)`.
4. **Same type registered twice** — throws `RegistrationError`. Use `builder.override.registerSingleton(...)` (tests, plugin replacements).
5. **A string key for a class** — `@inject("SampleService")` does not find `SampleService`. Pass the class.
6. **Two copies of a package** — the class from one copy is not the class from the other, so a service registered with one is not found with the other. Install each package once.
7. **A singleton depending on a request-scoped service** — throws; see [lifetimes](#registration-and-lifetimes).

---

## Non-goals

- Folder scanning / “declare a module and everything is registered”
- Property or setter injection (constructors only)
- Compile-time graph checking

## Dependencies

| Package | Role |
|---|---|
| [`@decohere/core`](../core) | Reflection helpers for `design:paramtypes` (`getMeta`, `isConstructable`, …) |

Layering: [architecture](../../docs/architecture/).
