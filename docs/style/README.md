# Code style

How code is written. New code follows this; if existing code disagrees, fix the code or change this page in a PR. Package rules: [architecture](../architecture/). Where files go: the [repo map](../README.md#repo-map).

## Class, namespace object or function

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

## Names

Functions do something; everything else is something.

- **Functions and methods are verbs:** `getOwnScript`, `runPackageScript`, `findWorkspaceRoot`, `build`. A predicate asks a question: `isBareSpecifier`, `hasEntry`. A function named like a value (`packageScriptCommand(options)`) reads as one, and the call site no longer says what happens.
- **Everything else is a noun:** classes, types, values, namespace objects and getters. `packageAliases.build(...)` reads "package aliases: build"; `project.name` is a property.
- **Except plugin factories.** A factory whose result goes straight into another tool's plugin list (Vite `plugins`, Astro `integrations`, the builder's `.use()`) is named for what it adds, as that tool's own plugins are: `plugins: [forgeAliases()]`, `.use(mikroOrm({ … }))`. The call site reads as a list of what the app is made of, and a verb (`createForgeAliasesPlugin()`) would stand out from every other plugin beside it.
- **Rename when you touch it.** When you change a function with a poor name, rename it in the same PR and update every caller. Anything a package doesn't export can be renamed at any time. Until 1.0, so can what a package exports: Decohere's public surface is small, and its packages are the main callers of each other. After 1.0, renaming an export is a breaking change, so now is the time to fix names.

## Rules

1. ES modules; `.js` extensions in TypeScript import paths.
2. Import through `package.json` `exports` and `tsconfig` paths.
3. Never `import type` a constructor-injected class. Guide: [`@decohere/crucible`](../../projects/crucible/README.md).
4. Suffixes: `*.decorator.ts`, `*.service.ts`, `*.controller.ts`, `*.types.ts`, `const.ts`, `*.spec.ts`.
5. Build outputs under `dist/` (`debug` / `release`).
6. Never silence an error to get past it: no empty `catch`, no error listener that only logs and carries on, no `any` or `@ts-expect-error` to turn a check green.
7. No issue or PR numbers in files: code, tests, docs and ADRs say the reason in words. The code is the source of truth; the link to a discussion lives in the commit and the PR (`Closes #N`).

Prefer a single `Map` lookup with a null guard over `has` + `get!`:

```ts
const value = map.get(key);
if (value == null) return;
```
