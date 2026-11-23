# Mocking a collaborator

When a unit must mock a dependency, mock as little as possible, keep the real types, and assert what your code did. Prefer a behavior suite whenever the outcome shows in files, HTTP or exit codes ([testing](../README.md#behavior-over-internals)).

## Pattern

Replace the module with hoisted `vi.mock`, using a class so code that does `new Shell()` gets the mock and TypeScript still sees the real `Shell` type. Share spies through `vi.hoisted`, because the factory runs before the file's other top-level code.

```ts
const run = vi.hoisted(() => vi.fn());

vi.mock("../../src/interop/shell/shell.js", () => ({
	Shell: class {
		public run = run;
	},
}));

import { Yarn } from "../../src/interop/yarn/yarn.js";

it("calls install with no extra flags", async () => {
	await new Yarn().install({ cwd: "/workspace" });
	expect(run).toHaveBeenCalledWith({ cwd: "/workspace" }, "install");
});
```

From `projects/devkit/tests/interop/yarn.spec.ts`. When the unit takes the collaborator as a constructor argument, pass `new Shell()` from the mocked module: it is typed as the real class.

## Test your code, not the mock

An assertion should fail if your code is wrong. If you mock `findFiles` to return two paths and then assert the result has those two paths, you tested the mock. Assert instead on what your code adds: the arguments it built, how it transformed or filtered the data, its caching, its errors.

## Pitfalls

- Don't hand-build dependency shapes with a type escape (`{ run: vi.fn() } as never`). A changed contract then still compiles and the test still passes.
- Mock only the collaborators the scenario needs.
- Assert through the public API, not private members.
