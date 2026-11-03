# Testing File Watching Without Chokidar Inlining

## Context

Decohere previously used a Vitest config override:

```ts
server: {
  deps: {
    inline: ["chokidar"],
  },
}
```

This was a workaround for earlier watcher behavior. Forge file watching now uses `watch` from `@decohere/devkit/io`, and unit/integration tests no longer depend on inlining `chokidar` through Vitest.

## What This Means for Unit Testing

- Unit tests should mock or exercise the `@decohere/devkit/io` watcher behavior directly.
- Do not add new Vitest `server.deps.inline` entries for `chokidar` unless a concrete regression requires it.
- Prefer testing watcher contracts (emitted event shape and path handling) at service boundaries.
- Keep integration tests outcome-focused (transformed output/files) rather than bundler-specific behavior.

## Current Recommended Pattern

1. Use the `watch` and `File` contracts (`@decohere/devkit/io`, `@decohere/core/io`).
2. Validate `fullPath`/`relativePath` semantics in service tests.
3. Use CLI integration tests for end-to-end watch behavior (build output updates, ignore behavior).

## Why This Is Better

- Reduces test runner coupling to a specific watcher package.
- Keeps tests aligned with production abstractions (`watch`) instead of implementation details.
- Simplifies Vitest config and avoids unnecessary dependency inlining.

## Troubleshooting

If watch tests start failing after dependency/runtime changes:

- First verify `watch` event behavior in devkit's tests (`projects/devkit/tests/io`).
- Then verify Forge service-level handling of `File` events.
- Only reintroduce Vitest dependency inlining as a last resort, with a targeted regression test and clear justification.
