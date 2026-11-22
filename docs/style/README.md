# Code style

How code is written. New code follows this; if existing code disagrees, fix the code or change this page in a PR. Package rules: [architecture](../architecture/). Where files go: the [repo map](../README.md#repo-map).

## One class per job

Decohere is **class-centric OOP + Crucible DI**, and SOLID applies to that spine ([ADR 0027](../adr/0027-code-design.md)).

- **Everything with state, a lifecycle, more than one implementation, or a rule is a class with one job, named for it.** Its state is private, with read-only getters where others need it. A calculation is a method on the thing it is about.
- **What kinds share is an abstract base class**, not a helper module they all import.
- **A service is an interface and a token, implemented by one injected class.** Dependencies come through the constructor, never `container.resolve` outside the composition root and the container itself.
- **Loose exported functions are only** plugin factories (`typeOrm()`), decorators (`@injectable()`), `define…` helpers whose result is data (`defineMigration`, `mapEntity`), and mechanics with no domain meaning (`sleep`). A group of related functions is a class, not a namespace object (`export const x = { a, b }`). Existing namespace objects become classes as they're touched.

```ts
@injectable()
export class PackageAliases {
	public constructor(@inject(WorkspaceToken) private readonly workspace: Workspace) {}

	public build(): Map<string, string> { /* … */ }

	public isBareSpecifier(specifier: string): boolean { /* … */ }
}
```

## Names

Functions do something; everything else is something.

- **Functions and methods are verbs:** `getOwnScript`, `runPackageScript`, `findWorkspaceRoot`, `build`. A predicate asks a question: `isBareSpecifier`, `hasEntry`. A function named like a value (`packageScriptCommand(options)`) reads as one, and the call site no longer says what happens.
- **Everything else is a noun:** classes, types, values and getters. `packageAliases.build(...)` reads "package aliases: build"; `project.name` is a property.
- **Except plugin factories.** A factory whose result goes straight into another tool's plugin list (Vite `plugins`, Astro `integrations`, the builder's `.use()`) is named for what it adds, as that tool's own plugins are: `plugins: [forgeAliases()]`, `.use(mikroOrm({ … }))`. The call site reads as a list of what the app is made of, and a verb (`createForgeAliasesPlugin()`) would stand out from every other plugin beside it.
- **Rename when you touch it.** When you change a function with a poor name, rename it in the same PR and update every caller. Anything a package doesn't export can be renamed at any time. Until 1.0, so can what a package exports: Decohere's public surface is small, and its packages are the main callers of each other. After 1.0, renaming an export is a breaking change, so now is the time to fix names.

## Rules

1. ES modules; `.js` extensions in TypeScript import paths.
2. Import through `package.json` `exports` and `tsconfig` paths.
3. Never `import type` a constructor-injected class. Guide: [`@decohere/crucible`](../../projects/crucible/README.md).
4. A file holds one thing and is named for it and its role: `route-path.value.ts`, `memory.plugin.ts`, `optimistic-lock.error.ts`. The roles are listed in [ADR 0027](../adr/0027-code-design.md#names); a missing one is added there first. No `utils`, `helpers`, `common`, `shared`, `misc`, `.types.ts`, `.store.ts` or verb-named files: a type lives beside the thing it describes. Existing files are renamed as they're touched.
5. Build outputs under `dist/` (`debug` / `release`).
6. Never silence an error to get past it: no empty `catch`, no error listener that only logs and carries on, no `any` or `@ts-expect-error` to turn a check green.
7. No issue or PR numbers in files: code, tests, docs and ADRs say the reason in words. The code is the source of truth; the link to a discussion lives in the commit and the PR (`Closes #N`).
8. Errors are named classes ending in `Error`, one per file (`OptimisticLockError` in `optimistic-lock.error.ts`), thrown and never swallowed.
9. No `process.env` in library code: config sources and bins read the environment and pass values in.

Prefer a single `Map` lookup with a null guard over `has` + `get!`:

```ts
const value = map.get(key);
if (value == null) return;
```
