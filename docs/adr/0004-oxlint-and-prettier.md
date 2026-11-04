# 0004. Lint with oxlint, format with Prettier

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

Biome did both jobs but needed 59 `biome-ignore` comments. 23 were `useImportType`: DI decorator metadata needs real value imports, so a rule that prefers `import type` fights the framework. Another 28 were `noNonNullAssertion` and `noExplicitAny`.

## Decision

- **oxlint** lints with its default rules (`.oxlintrc.json`). The rules that caused the ignores (`consistent-type-imports`, `no-non-null-assertion`, `no-explicit-any`) are not enabled.
- **Prettier** formats TypeScript, JavaScript, JSON and YAML: tabs, 95 columns (`.prettierrc.json`). Markdown is not formatted.
- `pnpm run lint` fixes (`oxlint --fix`, `prettier --write`). `pnpm run lint:check` is what CI runs; it fails on any warning (`--deny-warnings`).
- Suppress a rule on one line with `// oxlint-disable-next-line <rule> -- <why>`, always with the why.

## Consequences

- Two tools instead of one, both fast and barely configured.
- Imports are not sorted automatically. Add a Prettier plugin if that is missed.
- Explicit `public`/`private` (Biome's `useConsistentMemberAccessibility`) is not enforced.
- The scaffolder still generates Biome config for new projects. That is for Scaffolder v2 (M6) to decide.

## History

- 2026-10-11: Decided; replaces Biome.
