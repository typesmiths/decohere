# Testing

Vitest helpers for testing Decohere code ([ADR 0015](../../docs/contributing/adr/0015-core-devkit-testing.md)). Only for tests, never imported by library or app code.

| Export | What it does |
|---|---|
| `resetMemfs`, `seedMemfs`, `createTestFile`, `readFile`, `fileExists` | An in-memory file system ([memfs](https://github.com/streamich/memfs)) for tests that mock `node:fs` |
| `withMemfsFsForGlob` | Wraps the real `glob` module so its file access goes through memfs: real matching, in-memory files |
| `createMockLogger` | A scribe-shaped logger whose methods are `vi.fn()` spies |
| `spyOnConstructor` | Spies on a class constructor without losing `design:paramtypes`, so crucible can still inject it ([how-to](../../docs/contributing/testing/how-tos/vitest-constructor-spy-with-di.md)) |
| `flushPromises` | Waits until pending promise callbacks have run |

This repo routes file access to memfs in a Vitest setup file ([`vitest.setup.ts`](../../vitest.setup.ts)), with `__mocks__/fs.ts` re-exporting memfs:

```ts
// vitest setup file
vi.mock("node:fs");
vi.mock("node:fs/promises");
vi.mock("glob", async () => {
	const actual = await vi.importActual<typeof import("glob")>("glob");
	const { withMemfsFsForGlob } = await import("@decohere/testing");
	return withMemfsFsForGlob(actual);
});

// a test
import { resetMemfs, seedMemfs } from "@decohere/testing";

beforeEach(() => {
	resetMemfs();
	seedMemfs({ "/app/config/config.yaml": "name: api\n" });
});
```

`vitest` and `memfs` are peer dependencies: install them in the project that runs the tests ([ADR 0017](../../docs/contributing/adr/0017-dependency-manifests-from-imports.md)).

## Working on this package

For contributors to Decohere: how the package is laid out and tested. Using it needs nothing below.

`src/` is flat, one file per helper: `memfs.ts`, `glob-with-memfs.ts`, `mock-logger.ts`, `spy-on-constructor.ts` and `flush-promises.ts`. ADR 0027 names a `.cases.ts` suite, for an interface several implementations must pass, as a role that lives in `testing/`; none lives here yet (data's unit-of-work cases are in `projects/data/data/tests/contract/cases.ts`).

The package has no specs of its own and no canonical suite in the [testing table](../../docs/contributing/testing/README.md#canonical-suite-ownership). Every `pnpm test` and `pnpm test:docker` run uses its memfs helpers through `vitest.setup.ts`, so a break here shows up across the repo's suites.
