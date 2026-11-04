# 0018. `flux run` loads only what running a file needs

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

`flux run hello.ts` took about 340 ms against 40 ms for `node hello.ts`. The time went on loading code, not compiling: the TypeScript compiler alone took about 160 ms to load, and rxjs was 223 of the 590 modules loaded. Neither is needed to run a file. SWC strips types without checking them, and the workspace used the compiler only to read `tsconfig.json`, of which transpiling needs `paths` and `baseUrl`.

## Decision

- **No TypeScript compiler on the run path.** The workspace reads `tsconfig.json` with `get-tsconfig`, which follows `extends`, and checks the JSON itself, since get-tsconfig reads broken JSON as `{}`. Forge's type emission, which needs the compiler's full parse, parses the file with the compiler.
- **Flux imports `@decohere/forge/transpile`,** not `@decohere/forge`. The main entry exports `ForgeModule` and so every command, `typecheck` among them.
- **No rxjs.** Change events use the `Subject` in `@decohere/core/system`, the part of rxjs we used.
- **The bins switch on Node's compile cache** (`module.enableCompileCache()`), so a second start skips compiling the CLI's modules.
- **Not bundled, for now.** A bundled CLI would save about 70 ms more, but needs a bundling step in forge and has to keep the logger's worker thread and SWC's native binary outside the bundle.

`projects/cli/tests/flux.bin.startup.spec.ts` fails if a run loads `typescript` or `rxjs`.

## Consequences

- `flux run hello.ts` takes a median of about 145 ms against 405–470 ms before, on an idle machine with `node hello.ts` at about 40 ms and `tsx hello.ts` at about 110 ms. A cold start takes about 210 ms against 550 ms. It loads 303 modules instead of 590.
- A new import on the run path can undo this; the test catches the two known costs, not every slow module.
- Two readings of `tsconfig.json` exist: get-tsconfig's for transpiling, the compiler's for type emission. They differ only in what the transpiler doesn't read.
- One more dependency (`get-tsconfig`, one small dependency of its own); one fewer (`rxjs`).

## History

- 2026-11-04: Decided.
