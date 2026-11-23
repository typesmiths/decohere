# 0020. The merge queue tests the real install from a temporary registry, and Publish ships the build it tested

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

CI generated an app but never installed it, because the packages it needs weren't on npm yet. Three bugs reached users that way: a new app failed its own typecheck, its install failed on current pnpm, and an image held an older scaffolder.

Testing after publishing would find them, but only once a broken version was already on the `dev` tag. Testing on every PR would slow every change.

These checks first ran on the push to `main`, after the merge. A break could then land: checked-in recipes merged with a build that had lost its hidden files, `main` went red, and nothing published for hours. Proving the fix took CI runs started by hand on its branch, so one change had runs on its PR, in the queue, on `main` and by hand, and it wasn't clear which one counted.

## Decision

- PRs run the quick checks: lint, typecheck, unit tests, a release build and a publish dry run. A PR also builds the images or runs Docker-backed tests when those files change.
- The merge queue runs everything, docs-only or not: the quick checks, the coverage gate, Docker-backed tests, one release build stamped with its dev version, and `verify-release`, which takes that build, publishes it to a Verdaccio registry that exists only inside the job, builds the images, and uses them as a user would: the launcher, the generated app, and the install steps in the docs. The required `ci` check waits for all of it, so a failure drops the PR from the queue and `main` never sees it.
- GitHub's merge queue tests the exact commit that lands: `main` is fast-forwarded to it. So CI runs nothing on a push to `main`, and Publish, started by that push, ships the build of the queue's successful CI run for that same commit, found by its SHA. What was tested is byte for byte what ships, at the version stamped in the queue.
- A commit with no successful queue run (an admin bypass or a direct push) isn't published: Publish stops with a message, and never builds one itself.
- These tests pin exact tool versions, updated in PRs, so a new tool release can't fail a merge without warning.
- A `release/<major>.<minor>` branch doesn't go through the queue, so a push to it runs the same full suite, and a patch release takes that run's build.
- A stable release ships a tested build without rebuilding it or repeating the queue's checks. Started by hand in `publish.yml`, it changes only the version and pins in the build's `package.json` files, fails if the old version appears anywhere else, and passes the same `verify-release` checks before publishing. A build at two versions differed only in those files when measured, though images are rebuilt because the scaffolder pins versions.
- Until the first stable release, `latest` moves only by starting `promote-latest.yml`, and only to a version with a `v*` tag, so only a version that passed these checks and shipped. It has its own trusted publisher, so `publish.yml` never gets the right to move `latest`.

## Consequences

- A version that fails these checks never reaches npm, and a change that fails them never reaches `main`.
- Each commit is tested once, in the queue, and that run's result is the one to look at. Nothing needs a run started by hand.
- There is one copy of these checks, so nothing tests the same thing again after publishing.
- The queue takes as long as `verify-release`, the longest job, where before a merge only waited for the quick checks. `main`'s run of the same length is gone.
- Publish depends on the queue run's build still being there: CI keeps it 14 days, and Publish starts seconds after the merge.
- When the queue lands several PRs in one push, only the last one's run is shipped, and it contains the others.
- A local registry can't catch npm-side problems such as permissions; the publish itself still finds those.
- Publish builds its images again from the same package build, so the tested images aren't the pushed ones.

Not chosen:

- **Running on the push to `main`.** It's what this record decided first, because a queue build seemed to carry a different version from the one `main` would publish. But the queue's commit is `main`'s commit, so its build can ship as is, and running after the merge let breaks land.
- **Rebuilding in Publish when no queue run exists.** It would ship a build nothing tested.
- **Starting Publish when the queue's run finishes.** A queue run can pass and still not land, when a PR ahead of it fails.
- **Installing package files directly.** Each nested `@decohere/*` package would need an override, which isn't what users do.

## History

- 2026-11-05: Decided, after those bugs reached users.
- 2026-11-05: Added stable releases from a tested build, replacing the long-running `release` branch.
- 2026-11-05: Shortened merges: images and Docker-backed tests left the queue and most PRs, and `main` stopped repeating the queue's checks. An image break can now land on `main`, where this check stops it from being published.
- 2026-11-05: Added promoting to `latest` from a manually started workflow, which npm's trusted publishing has allowed since 2026-09-30.
- 2026-11-06: Added patch releases: a `release/<major>.<minor>` branch cut from a tag, which runs full CI, and is released from its own tested build.
- 2026-11-23: Moved the full suite into the merge queue, after a build that lost its hidden files merged and held up publishing for hours. CI no longer runs on `main`; Publish starts on the push to `main` and ships the queue run's build for that commit, and refuses a commit the queue didn't test. Images and Docker-backed tests are back in the queue.
