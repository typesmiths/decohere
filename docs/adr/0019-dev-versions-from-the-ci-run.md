# 0019. Dev versions come from the CI run, chosen once; tags only record what shipped

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Dev versions were the latest `v*` git tag plus one, but that tag is only pushed when a publish has fully finished, minutes after CI starts. CI worked out the version before building, and each Publish job worked it out again.

So when two merges landed close together, the second build was stamped with a number the first publish then took. Publish picked the next number but uploaded the older build, npm said those versions already existed, every package was skipped, and the npm job reported success with nothing published.

A failed publish had a related hazard: it leaves no tag, so the next commit could pick a number already on npm, be skipped, and be tagged as shipped.

## Decision

- A dev version is `<base>-dev.<YYYYMMDD>.<run number>`, such as `0.0.1-dev.20261104.512`. The base is the major.minor.patch of the root `package.json`, the date is the HEAD commit's date in UTC, and the number is CI's `github.run_number`.
- It is chosen once, in CI, before the release build: `forge version --channel dev --build-number <n>`. Forge takes the number as a flag and reads no CI variable ([architecture §1](../architecture/README.md#1-keep-the-product-pure-of-its-host)).
- Publish never works out a version. It reads it from the build with `forge version --from-build`, which fails if the built packages disagree.
- A `v*` tag only records that a commit fully shipped. Nothing reads tags to pick a dev version.
- Stable releases are unchanged: they still go through changesets and `release-prep.yml`.

## Consequences

- Merges can't collide, because each CI run has its own number. Re-running a run keeps its number, so retries are safe and "already on npm" means this run already published.
- CI needs no tags and no full git history to choose a version.
- Numbers have gaps, because pull request and merge queue runs share the counter. Nothing depends on them being consecutive.
- The version belongs to the run, not the commit: a new CI run on the same commit publishes the same code under a second version. A commit that fully shipped is still skipped, because it has a `v*` tag.
- The base stays until `main`'s root `package.json` changes, so the first stable release must raise it there, or dev versions will sort below the stable one.
- A manual release has no run number and has to supply one ([CI and release](../ci/README.md#emergency-manual-release)).

Not chosen:

- **A count of commits on `main`.** It ties the version to the commit, but needs full history, and a shallow checkout gives a wrong number with no error.
- **Keeping tags and failing on a mismatch.** The failure would be louder, but merges would still collide.

## History

- 2026-11-04: Decided, after a publish reported success on `main` while publishing nothing.
