# Files in memory (memfs)

Tests in the `unit` and `docker` projects never touch the real disk by default. The root `vitest.setup.ts` does three things:

- mocks `fs`, `fs/promises`, `node:fs` and `node:fs/promises` to memfs (root `__mocks__/fs.ts`);
- mocks `glob` to the real `glob` reading memfs (`withMemfsFsForGlob` from `@decohere/testing`);
- registers a Node module load hook: when `import()` loads a path that exists in memfs, the source comes from memfs.

## Pattern

Seed memfs, run the code, assert on memfs, reset after each test:

```ts
import { fileExists, resetMemfs } from "@decohere/testing";
import { vol } from "memfs";

afterEach(() => resetMemfs());

it("loads config from .decohere.js", async () => {
	vol.fromJSON({ [configFile]: `export default { rootDir: "/CUSTOM_ROOT" }` });

	expect(await UserConfigFactory.getUserConfig(configFile)).toEqual({ rootDir: "/CUSTOM_ROOT" });
});
```

From `projects/forge/tests/workspace/user-config.factory.spec.ts`. `@decohere/testing` also has `seedMemfs`, `createTestFile`, `readFile` and `fileExists`.

Tests use memfs. Touch the real disk only when something outside the test reads or writes files: a child process, a worker thread (such as a pino transport), or a real fixture or source file you copy into memfs. Then import `realFs` from `vitest.setup.ts` rather than calling `vi.importActual` again, and clean up in `afterEach`.

To use the real disk for a whole suite, `vi.unmock` the four `fs` ids (see `projects/devkit/tests/io/watch.real-fs.spec.ts`).

## Pitfalls

- memfs is not reset for you. Call `resetMemfs()` in `afterEach`, or state leaks between tests.
- For `import()` to be served from memfs, the file must also exist on disk, so Vite treats it as external and Node loads it. Keep a placeholder in `tests/__fixtures__/` and, if Vite still inlines it, add its path to `server.deps.external` in `vitest.config.ts`.
- ESM caches modules by URL. Two tests importing the same path get the first content; use one fixture file per test (as `.decohere.js` and `.decohere.projects.js` do) or a `?version=` query ([env-dependent decorators](testing-environment-variables-with-decorators.md)).
- `fs.watch` works against memfs, so watchers can be tested in memory (`projects/devkit/tests/io/watch.spec.ts`). Atomic-save behavior needs the real disk.
