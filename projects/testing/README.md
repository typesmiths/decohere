# Testing

Vitest helpers for testing Decohere code ([ADR 0015](../../docs/adr/0015-core-devkit-testing.md)). Only for tests, never imported by library or app code.

| Export | What it does |
|---|---|
| `resetMemfs`, `seedMemfs`, `createTestFile`, `readFile`, `fileExists` | An in-memory file system ([memfs](https://github.com/streamich/memfs)) for tests that mock `node:fs` |
| `withMemfsFsForGlob` | Wraps the real `glob` module so its file access goes through memfs: real matching, in-memory files |
| `createMockLogger` | A scribe-shaped logger whose methods are `vi.fn()` spies |
| `spyOnConstructor` | Spies on a class constructor without losing `design:paramtypes`, so crucible can still inject it ([how-to](../../docs/testing/how-tos/vitest-constructor-spy-with-di.md)) |
| `flushPromises` | Waits until pending promise callbacks have run |

This repo routes file access to memfs in a Vitest setup file ([`test/fs.setup.ts`](../../test/fs.setup.ts)), with `__mocks__/fs.ts` re-exporting memfs:

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

`vitest` and `memfs` are peer dependencies: install them in the project that runs the tests ([ADR 0017](../../docs/adr/0017-dependency-manifests-from-imports.md)).
