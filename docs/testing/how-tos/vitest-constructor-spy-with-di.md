# Constructor spy under DI

To assert what crucible injected into a constructor, a bare `vi.fn` or `vi.spyOn` on the class does not work: crucible reads `design:paramtypes` from `reflect-metadata`, the spy has none, and the constructor gets no arguments. Container usage: [crucible README](../../../projects/crucible/README.md).

## Pattern

`spyOnConstructor` from `@decohere/testing` returns a `Proxy` that records constructor arguments, builds the real instance, and copies the class's metadata so the container can still resolve it. Register the proxy where the class would go.

```ts
import { spyOnConstructor } from "@decohere/testing";

it("injects the workspace into the action", async () => {
	const { spy, Proxy: SpiedAction } = spyOnConstructor(WorkspaceDependentAction);

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

	expect(spy).toHaveBeenCalledWith(expect.any(FakeWorkspace));
});
```

From `projects/cli/tests/module.factory.spec.ts`.

## Simpler, when it is enough

If you only need the injected value, spy on a prototype method and read it from the instance:

```ts
const runSpy = vi.spyOn(MyService.prototype, "run");
// ... run the code ...
expect((runSpy.mock.instances[0] as MyService).dependency).toBeInstanceOf(ExpectedDep);
```
