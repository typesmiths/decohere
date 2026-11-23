# Fail-fast glob mock

By default `glob` is the real one reading memfs ([Files in memory](module-load-hooks-with-memfs.md)). Seeding memfs and letting it match is usually the better test. For a pure unit where you want to state exactly what `glob` returns, mock it.

## Pattern

`vi.mock("glob")` with no factory loads root `__mocks__/glob.ts`, whose `glob` throws until a test overrides it. A test that forgets to say what `glob` returns fails instead of passing on an empty match.

```ts
import * as glob from "glob";
import { findFile } from "../../src/io/find-file.js";

vi.mock("glob");

beforeEach(() => vi.clearAllMocks());

it("returns the first match", async () => {
	vi.spyOn(glob, "glob").mockResolvedValue(["src/index.ts", "src/utils.ts"]);

	expect(await findFile("**/*.ts")).toEqual({ relativePath: "src/index.ts" });
});
```

From `projects/devkit/tests/io/find-file.spec.ts`.

## Pitfalls

- Don't give the mock a permissive default such as `[]`.
- Override per test with `vi.spyOn(glob, "glob")`; don't share return values across tests.
