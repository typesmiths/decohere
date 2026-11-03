# 0003. No changesets until the first public release

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

Changesets record what changed for users of a published package, so a release can be versioned and its notes written. Until now every PR to a published package needed one, or the `skip-changeset` label, and CI failed without it.

Nothing Decohere has built so far was a public release. The npm packages are not public, and everything up to now has been prototype and testing. Release notes for work no one else ran are noise: 110 changesets piled up, and the `release` branch has not moved since 2026-05-08.

## Decision

- **No changesets until the first public npm release** (0.1.0, milestone M8). PRs do not add `.changeset/` files or the `skip-changeset` label.
- CI no longer checks for changeset entries, and `pnpm qa` no longer runs `changeset:check`.
- The pending changesets were deleted. `.changeset/config.json` and the tooling (`changeset:check`, `version:aggregate`, `forge version --from-changesets`) stay, unused, ready for the release.
- When the packages go public, start tracking changesets and releases again, and write a new ADR (or update this one's History) saying so.

## Consequences

- Contributors have one less rule, and docs-only and CI-only PRs need no label.
- The stable lane (`release-prep.yml` → `release` branch → `release.yml`) has nothing to version. It is dormant until the first public release.
- Pre-release history is not in release notes. The git log and closed issues are the record of the prototype.
- Nothing stops a breaking change from going out unannounced, because nothing outside the team depends on these packages yet. That stops being true at 0.1.0.
