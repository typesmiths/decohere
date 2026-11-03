# Asserting DI Constructor Arguments with `spyOnConstructor`

Usage of the container itself: [`@decohere/crucible` README](../../../projects/crucible/README.md).

## Problem

When testing Crucible DI wiring you sometimes need to assert **what was injected into a constructor** — not just that the class ran, but that it received the right dependency instance.

Naively spying on a constructor via `vi.spyOn` or `vi.fn` breaks because:
- The container reads `design:paramtypes` metadata from `reflect-metadata` to resolve deps
- A bare spy/mock object has no metadata, so the container resolves zero args
- The constructor is called with `undefined` instead of the real dependency

## Solution — `spyOnConstructor` from `@decohere/testing`

```typescript
import { spyOnConstructor } from "@decohere/testing";

const { spy, Proxy: SpiedService } = spyOnConstructor(MyService);
```

- Creates a `Proxy` that intercepts `new MyService(...)` calls and records args via `spy`
- Delegates to `Reflect.construct(MyService, args)` so the real instance is returned
- Copies all `reflect-metadata` keys from the original class onto the proxy so the container can still resolve dependencies

Use `SpiedService` in place of `MyService` wherever the class is registered in the DI container.

## When to Use

- Asserting that the DI container wired the correct dependency instance into a constructor
- Verifying constructor arguments when `@injectable()` + `reflect-metadata` is involved

## Example

```typescript
it("should inject the workspace into the action constructor", async () => {
    const { spy: ctorSpy, Proxy: SpiedAction } = spyOnConstructor(WorkspaceDependentAction);

    class SpiedModule extends ModuleManifest {
        public readonly id = "test";
        public readonly command = TestCommand;
        public readonly actions = { action: SpiedAction };
        public override createWorkspace() {
            return Promise.resolve(new FakeWorkspace());
        }
    }

    const mod = ModuleFactory.create(new SpiedModule(), () => {});
    await mod.command.parseAsync([], { from: "user" });

    expect(ctorSpy).toHaveBeenCalledWith(expect.any(FakeWorkspace));
});
```

## Simpler Alternative — Prototype Method Spy

If you only need to verify _what was injected_ (not intercept the constructor itself), spy on a prototype method and read the dependency from `this`:

```typescript
const runSpy = vi.spyOn(MyService.prototype, "run");
// ... trigger execution ...
const instance = runSpy.mock.instances[0] as unknown as MyService;
expect(instance.dependency).toBeInstanceOf(ExpectedDep);
```

Prefer this when constructor interception is not strictly necessary — it requires no proxy setup and no metadata copying.

## Why the Metadata Copy Is Required

`reflect-metadata` stores type info in a `WeakMap` keyed by the **original constructor object**. A `Proxy` is a distinct object, so `Reflect.getMetadata("design:paramtypes", proxy)` returns `undefined`. The container sees no params and calls the constructor with zero arguments.

Copying metadata keys from the original to the proxy bridges this gap:

```typescript
for (const key of Reflect.getMetadataKeys(Target)) {
    Reflect.defineMetadata(key, Reflect.getMetadata(key, Target), ProxiedTarget);
}
```

This is handled internally by `spyOnConstructor` — you do not need to do it manually.
