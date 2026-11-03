# 0004. Lint with oxlint, format with Prettier

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

Biome did both jobs, but it was a recurring annoyance, and it needed 59 `biome-ignore` comments. 23 of them were `useImportType`: DI decorator metadata needs real value imports, so a rule that prefers `import type` fights the framework. Another 28 were `noNonNullAssertion` and `noExplicitAny`.

## Decision

- **oxlint** lints, with its default rules. Config is `.oxlintrc.json`. The rules that caused the ignores (`consistent-type-imports`, no-non-null-assertion, no-explicit-any) are not enabled.
- **Prettier** formats TypeScript, JavaScript, JSON and YAML: tabs, 95 columns (`.prettierrc.json`). Markdown is not formatted, as before.
- `pnpm run lint` fixes (`oxlint --fix`, `prettier --write`). `pnpm run lint:check` is what CI runs and fails on any warning (`--deny-warnings`).
- Suppress a rule on a line with `// oxlint-disable-next-line <rule> -- <why>`, and always say why.

## Consequences

- Two tools instead of one, but both are fast and neither is configured beyond a few lines.
- Import order is no longer sorted automatically. Add a Prettier plugin if that is missed.
- Biome's `useConsistentMemberAccessibility` (explicit `public`/`private`) is no longer enforced.
- The scaffolder still generates Biome config for new projects. That is a product decision for M6 (Scaffolder v2), not this one.
