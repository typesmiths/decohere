# Env-dependent decorators

Some decorators read the environment when the class is defined, that is, when its module is imported. `@cache()` is skipped when `FORGE_DISABLE_CACHE=true` (`ignoreIf` in `projects/core/src/system/decorator.ts`). Setting the variable inside a test is too late: the module is already imported and cached.

## Pattern

Put the decorated class in its own file and import it fresh in each test, with a unique query string so Node does not reuse the cached module.

```ts
import path from "node:path";
import { pathToFileUrl } from "../../src/io/url-to-path.js";

const freshImport = () =>
	import(`${pathToFileUrl(path.resolve(__dirname, "./cache-test-class.js"))}?version=${Date.now()}`);

afterEach(() => {
	delete process.env.FORGE_DISABLE_CACHE;
});

it("does not cache when FORGE_DISABLE_CACHE=true", async () => {
	process.env.FORGE_DISABLE_CACHE = "true";
	const { CacheTestClass } = await freshImport();
	const instance = new CacheTestClass();

	instance.syncMethod(5);
	instance.syncMethod(5);

	expect(instance.callCount).toBe(2);
});
```

From `projects/core/tests/caching/cache.decorator.spec.ts`, with the class in `cache-test-class.ts` beside it.

## Pitfalls

- Clear the variable in `afterEach`, or it leaks into later tests.
- `pathToFileUrl` here is core's helper (`projects/core/src/io/url-to-path.ts`), not Node's `pathToFileURL`.
