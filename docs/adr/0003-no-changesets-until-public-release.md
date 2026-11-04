# 0003. No changesets until the first public release

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

Changesets record what changed for users of a published package, so a release can be versioned and its notes written. Every PR to a published package needed one, or a `skip-changeset` label, and CI failed without it.

Nothing released so far is for outside use: npm carries only `-dev` pre-releases. Release notes for work no one else ran are noise, and the pending changesets kept piling up.

## Decision

- **No changesets until the first public npm release** (0.1.0, milestone M8). PRs add no `.changeset/` files and no `skip-changeset` label.
- CI does not check for changesets, and `pnpm qa` does not run `changeset:check`.
- `.changeset/config.json` and the tooling (`changeset:check`, `version:aggregate`, `forge version --from-changesets`) stay, unused, ready for the release.
- When the packages go public, changesets come back and this record's History says so.

## Consequences

- One less rule; docs-only and CI-only PRs need no label.
- The stable lane (`release-prep.yml` → `release` branch → `release.yml`) has nothing to version and is dormant until 0.1.0.
- Pre-release history is not in release notes; the git log is the record.
- A breaking change can go out unannounced. That is acceptable only while nothing outside the team depends on the packages, which stops being true at 0.1.0.

## History

- 2026-10-11: Decided. The pending changesets were deleted.
