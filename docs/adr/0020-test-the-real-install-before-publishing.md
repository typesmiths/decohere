# 0020. `main` tests the real install from a temporary registry before publishing

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

CI generated an app but never installed it, because the packages it needs weren't on npm yet. Three bugs reached users that way: a new app failed its own typecheck, its install failed on current pnpm, and an image held an older scaffolder.

Testing after publishing would find them, but only once a broken version was already on the `dev` tag. Testing on every PR would slow every change.

## Decision

- PRs run the quick checks: lint, typecheck, unit and Docker-backed tests, a release build and a publish dry run.
- A push to `main` also runs `verify-release`. It takes the stamped build, publishes it to a Verdaccio registry that exists only inside the job, builds the images, and uses them as a user would: the launcher, the generated app, and the install steps in the docs.
- Publish runs only if that passes, and uploads the same package build.
- These tests pin exact tool versions, updated in PRs, so a new tool release can't fail a merge without warning.
- `latest` moves only by starting `promote-latest.yml`, and only to a version with a `v*` tag, so only a version that passed these checks and shipped. It has its own trusted publisher, so `publish.yml` never gets the right to move `latest`.

## Consequences

- A version that fails these checks never reaches npm.
- There is one copy of these checks, so nothing tests the same thing again after publishing.
- Broken code can land on `main`. Nothing is published, but `main` stays red and publishing stops until a fix or revert lands.
- A local registry can't catch npm-side problems such as permissions; the publish itself still finds those.
- Publish builds its images again from the same package build, so the tested images aren't the pushed ones.

Not chosen:

- **Running in the merge queue.** It would keep broken code off `main`, but its build carries a different version from the one `main` publishes.
- **Installing package files directly.** Each nested `@decohere/*` package would need an override, which isn't what users do.

## History

- 2026-11-05: Decided, after those bugs reached users.
- 2026-11-05: Added promoting to `latest` from a manually started workflow, which npm's trusted publishing has allowed since 2026-09-30.
