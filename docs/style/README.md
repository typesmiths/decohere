# Code style

Normative. New code follows this. If existing code disagrees, fix the code — or amend this file in a docs PR.

Architecture (packages, layout): [../architecture/](../architecture/). Process: [../contributing/](../contributing/).

## Types of code — class, namespace, loose function

Decohere is **class-centric OOP + Crucible DI**. SOLID applies to that spine.

| Shape | When |
|---|---|
| **Class + `@injectable`** | State, lifecycle, polymorphism, or more than one implementation of a port. |
| **Namespace object** | Related functions that are not a type. `export const foo = { bar, baz }` at the **bottom of the file**. Callers write `foo.bar(...)`. Multi-file: `export * as io from "./io.js"`. |
| **Loose `export function`** | Sparingly. Prefer a namespace or a method on the owner. |

Do **not** convert the framework to a bag of functions. Do **not** invent a class for `isBareSpecifier`.

```ts
function build(/* … */) { /* … */ }
function isBareSpecifier(/* … */) { /* … */ }

export const packageAliases = { build, isBareSpecifier };
```

## Structural

1. ES modules; `.js` extensions in TypeScript import paths.
2. Import through `package.json` `exports` and `tsconfig` paths.
3. Never `import type` a constructor-injected class. Guide: [`@decohere/crucible`](../../projects/crucible/README.md).
4. Suffixes: `*.decorator.ts`, `*.service.ts`, `*.controller.ts`, `*.types.ts`, `const.ts`, `*.spec.ts`.
5. Build outputs under `dist/` (`debug` / `release`).
6. No issue or PR numbers in files: code, tests, docs and ADRs say the reason in words. The code is the source of truth; the link to a discussion lives in the commit and the PR (`Closes #N`).

Prefer a single `Map` lookup with a null guard over `has` + `get!`:

```ts
const value = map.get(key);
if (value == null) return;
```
