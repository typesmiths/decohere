# @decohere/ci-tools

Node scripts the repo's GitHub workflows and root `package.json` scripts run. Plain `.mjs`, run from source with `node`. One folder per job, under `src/`:

- `audit/`: summarize `npm audit`, fail on findings (`enforce`), and open or close the audit issue (`upsert-issue`). Run by CI (`ci.yml`) and the nightly `npm-audit.yml`.
- `badges/`: the CI status badge (`ci-status`). Run by `pages.yml`, `bench.yml` and `clear-benchmark-history.yml`.
- `bench/`: build benchmarks (`pnpm bench`, `pnpm bench:save`, `pnpm perf:trace`), and the nightly run and its regression issues. Run by `bench.yml`.
- `changeset/`: changeset status and changelog scripts behind `pnpm changeset:check` and `pnpm version:aggregate`. No workflow runs them.
- `coverage/`: the coverage report (`pnpm test:coverage:report`) and its badge, run by `pages.yml`.
- `github/`: GitHub and npm checks (`ensure-metadata` is used by `publish-verify`): `first-publish-check` (CI), `publish-verify` (`publish.yml`), `failure-report` (the `failure-report` action, used by `ci.yml` and `clear-benchmark-history.yml`), and `npm-bootstrap` (`pnpm npm:bootstrap`, run by hand).
- `lib/`: what the scripts share: SVG badges, LCOV parsing, GitHub issues, the workspace's packages. Nothing runs it directly.
- `pages/`: the GitHub Pages site (badges, bench history, the artifact). Run by `pages.yml`, `bench.yml` and `clear-benchmark-history.yml`.
- `release/`: publishing: `check-patch-release`, `find-publish-base` and `restamp-build` (`publish.yml`), `promote-latest` (`promote-latest.yml`, the "Promote to latest" workflow), and `publish-to-temporary-registry` (the `verify-release` action).

## Working on this package

Tests are in `tests/`, in folders named like the `src/` folders they test: `*.test.mjs` and, under `release/`, `*.spec.ts`. `pnpm test` runs both. `tests/github/ci-workflow.test.mjs` and `publish-workflow.test.mjs` check the workflow files themselves. There is no canonical suite for ci-tools in the [testing table](../../docs/contributing/testing/README.md#canonical-suite-ownership).
