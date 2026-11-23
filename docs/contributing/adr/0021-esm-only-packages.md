# 0021. Published packages are ESM only

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Every package advertised a CommonJS entry, but `require()` of any of them crashed with `exports is not defined in ES module scope`. Each has `"type": "module"`, so Node read the `commonjs/` build as ES modules, and some of that output uses `import.meta`, so it wouldn't have worked even if Node read it as CommonJS. Nothing tested it, and every package shipped a second build nobody could load.

## Decision

- `@decohere/*` packages offer ESM only: no `require` condition in `exports`, and no `commonjs/` build.
- Forge's default release build makes ESM and type declarations. It still has a `commonjs` target for anyone who sets it in their own configuration.

## Consequences

- `require()` of a package fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED`, which says what's wrong, instead of a crash from inside the package. A CommonJS project can use `await import()`.
- Packages are smaller, and release builds do less.
- CommonJS can come back if someone needs it. It would need fixing and a test that loads it.

## History

- 2026-11-05: Decided, after finding the CommonJS entries had never worked.
