# Vitest Glob Auto-Mock: Fail-Fast + Explicit Override

## Problem

When tests use `vi.mock("glob")` with a permissive default mock (for example returning `[]`), tests can silently pass with no file discovery and hide real regressions.

At the same time, tests that always provide inline mock factories can drift from real module shape if `glob` changes API.

## Goal

- Make `glob` mocking safe-by-default.
- Force each test to explicitly define expected `glob` behavior.
- Surface API shape changes early.

## Recommended Pattern

1. Use `vi.mock("glob")` to load `__mocks__/glob.ts`.
2. Make the default auto-mock implementation throw.
3. Type the mocked `glob` function from the real module export type.
4. In each test, override behavior with `vi.spyOn(globModule, "glob")`.

## Auto-Mock Implementation

```typescript
// __mocks__/glob.ts
type GlobFn = typeof import("glob")["glob"];

export const glob = ((..._args: unknown[]) => {
	throw new Error(
		'Mocked "glob" was called without an explicit test override. See docs/testing/how-tos/vitest-glob-automock-fail-fast.md for the recommended pattern.',
	);
}) as unknown as GlobFn;

const mockedGlob = {
	glob,
};

export default mockedGlob;
```

## Test Usage

```typescript
import * as globModule from "glob";
import { describe, expect, it, vi } from "vitest";
import { findFile } from "../../src/io/find-file.js";

vi.mock("glob");

describe("findFile", () => {
	it("fails fast when glob is not configured", async () => {
		await expect(findFile("**/*.ts")).rejects.toThrow(
			'Mocked "glob" was called without an explicit test override.',
		);
	});

	it("works when glob is explicitly overridden", async () => {
		vi.spyOn(globModule, "glob").mockResolvedValue(["src/index.ts"] as never);

		await expect(findFile("**/*.ts")).resolves.toEqual({
			relativePath: "src/index.ts",
		});
	});
});
```

## Why This Is Safer

- **Fail-fast defaults**: tests cannot accidentally rely on empty discovery.
- **Explicit intent**: each test declares exactly what `glob` should return.
- **API drift signal**: `typeof import("glob")["glob"]` ties mock signature to real export shape.

## When to Use a Custom Factory Instead

For integration scenarios where you need near-real `glob` behavior (for example `memfs` file system injection), use an explicit `vi.mock("glob", factory)` in that test suite.

Keep that separate from unit-test auto-mock usage.

## Guardrails

- Do not return `[]` as a default auto-mock behavior for `glob`.
- Do not share global `glob` return values across test cases.
- Reset spies/mocks in `beforeEach`.
- Prefer per-test `vi.spyOn(globModule, "glob")` overrides.

## Related

- [Vitest Mocking with Type Safety](./vitest-mocking-with-type-safety.md)
- [Unit Test Design Principles](./unit-test-design-principles.md)
