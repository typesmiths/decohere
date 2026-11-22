# Working on Decohere

For people changing Decohere itself, and the coding agents that do. Building an app with Decohere? See the [guide](../guide/). Coding agents follow [AGENTS.md](../../AGENTS.md), which points here.

| Question | Answer |
|---|---|
| How do I set up, and which commands do I run? | [Set up](#set-up), [everyday commands](#everyday-commands) |
| How does a change get from an issue to `main`? | [How work flows](#how-work-flows) |
| Where does a file go? | [Repo map](#repo-map) |
| How are the packages layered, and what must every package respect? | [Architecture](architecture/) |
| How is code written? | [Code style](style/): one class per job with Crucible DI, files named `<thing>.<role>.ts`, do's and don'ts, samples to copy |
| How do I test, and where do tests go? | [Testing](testing/), with [how-tos](testing/how-tos/) for memfs, mocks and DI spies |
| What runs in CI, and how is a release published? | [CI and release](ci/) |
| Why was something decided this way? | [Decisions (ADRs)](adr/), one record per topic |
| How is a package built and tested? | Its README, under **Working on this package** |

## Set up

Node 24 (`.node-version`) and pnpm; `corepack enable` gives you the pinned pnpm. No npm login, `.env` file or setup script.

```bash
git clone https://github.com/typesmiths/decohere.git
cd decohere
pnpm install
pnpm test
```

**Dev Container (optional):** "Reopen in Container" installs dependencies on first start. Log in once per machine with `gh auth login` and sign in to your agent. Both logins survive rebuilds: GitHub's is in `~/.config/decohere/gh/decohere/` on your machine, and your agent's is in a Docker volume.

This repo's container also starts Claude Remote Control, listed in claude.ai/code as `decohere-container`. It needs a claude.ai login, and it can't start until you answer two prompts once in a terminal: run `claude` and accept the prompt to trust the folder, then run `claude remote-control`, answer `y`, and press Ctrl+C. The answers survive rebuilds. Its log is `~/.cache/claude-remote-control.log`.

## Everyday commands

Tests and the CLIs run straight from the TypeScript in `projects/` ([`tools/register.mjs`](../../tools/register.mjs) compiles as Node loads), so nothing needs building first.

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests. No build, Docker, network or tokens |
| `pnpm test:file <path>` | One test file, e.g. `pnpm test:file projects/<package>/src/<subdomain>/<file>.spec.ts` (no `--`) |
| `pnpm test:watch` | Re-run tests on save |
| `pnpm test:docker` | Tests that need Docker (`*.docker.spec.ts`), e.g. a real Postgres |
| `pnpm run test:coverage` | Unit tests with coverage |
| `pnpm run test:e2e` | End-to-end tests of the built CLIs and the scaffolder |
| `pnpm run lint` | Fix with oxlint and Prettier (`lint:check` only checks) |
| `pnpm run typecheck` | Type check |
| `pnpm forge <command>` | The forge CLI from source |
| `pnpm flux run <file.ts>` | Run a TypeScript file from source |
| `pnpm run forge:build` | Build every package into `dist/` (only for e2e tests or inspecting output) |

## How work flows

GitHub is the only tracker; the plan is the milestones.

1. **Issue.** Every change starts as an issue in a milestone: the problem, the fix, what "done" means, and a `size: S`/`M`/`L` label. Title: `<type>(<area>): <summary>`, e.g. `fix(http): cache remote JWKS`. Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.
2. **Branch.** One issue, one branch, one PR, from the latest `main`: `git switch -c <type>/<issue>-<slug> origin/main` (e.g. `fix/512-cache-jwks`). Several at once? One worktree each: `git worktree add ../decohere-<issue> -b <branch> origin/main`.
   - **Issues that build on each other share one branch and one PR.** If issue B needs A's code, or both change the same files, do them together: name the branch for the first issue and list each in the body (`Closes #A`, `Closes #B`). Squash merges give every PR a new commit on `main`, so a second PR branched off the first conflicts with `main` as soon as the first merges.
   - **If a stack really is worth it** (big pieces that need reviewing apart), make it a GitHub stack and, after each merge, use its **Rebase stack** button to move the rest onto `main`. Never fix a stacked branch by merging `main` or its parent into it: the merge commit leaves the stack "diverged" and GitHub can't rebase it any more.
3. **Change.**
   - Bugs: a failing test first, then the fix, then the same test again.
   - Test behaviour, not wiring ([testing](testing/)).
   - A lasting design choice updates its [ADR](adr/), and [architecture](architecture/) or [style](style/), in the same PR. New code follows [style](style/) and adds no break of [ADR 0027](adr/0027-code-design.md); a PR that fixes some lowers the baseline with `pnpm design:check --update`.
   - Changed a `package.json`? Run `pnpm install` and commit `pnpm-lock.yaml`.
   - No changesets for now ([ADR 0003](adr/0003-no-changesets-until-public-release.md)).
   - Before pushing: `pnpm qa` (lint:check, typecheck, unit tests; `pnpm run lint` fixes what it can). Changed data code? Also `pnpm test:docker`.
4. **Pull request.** Push and open one early (`gh pr create --fill --draft`). The template asks for the problem, what changed and how we know it works: write it for someone new to the code, and end with `Closes #<issue>`. Mark it ready when CI is green.
5. **Merge.** Click merge. Once `ci` passes, the PR joins `main`'s merge queue: GitHub tests it on top of `main` and the PRs ahead of it, then squash-merges it. If that run fails, the PR leaves the queue and `main` is untouched. No need to update branches by hand.
6. **Clean up.** `git switch main && git pull`, then `git branch -D <branch>` (squash merges don't look merged to git) and `git worktree remove ../decohere-<issue>` if you used one.

## CI

Every PR and merge-queue run does lint, typecheck, unit tests and a package check. A PR also builds the images or runs the Docker tests when those files change. A PR that only touches docs (nothing in [`code-paths-filter.yml`](../../.github/ci/code-paths-filter.yml)) skips them. `main` is the integration run: images, Docker tests, coverage and a real install, so a break there stops publishing. A merge to `main` publishes a dev release. Details: [CI and release](ci/).

## Adding a package

You can propose a new package without any npm access. A package's first publish needs an owner's npm login, so an owner does it: see [Adding a new npm package](ci/#adding-a-new-npm-package).

## Repo map

```text
projects/                 every package (no top-level packages/); groups: scribe/, data/
  <package>/
    package.json          dependencies are generated from imports: pnpm forge dependencies sync
    README.md             how to use the package, then "Working on this package": its layout and tests
    src/
      index.ts            public barrel; the src/ root holds little else (a CLI's bin and module)
      <subdomain>/        routing/, auth/, caching/: one folder per subdomain, with its own
                          index.ts; a folder per kind inside (errors/, decorators/) once it
                          holds several
        router.service.ts       one thing per file, named <thing>.<role>.ts
        router.service.spec.ts  the spec beside the file it tests
    tests/                legacy: specs still here move beside their code, package by package;
                          fixtures and test-only helpers stay here until the release build
                          leaves them out of src/
    e2e/                  end-to-end suites against built output (cli, create, forge)
docs/
  README.md               which folder is for whom
  guide/                  for developers using Decohere: why, getting started, recipes
  contributing/           for people changing Decohere: this page, architecture/, style/,
                          testing/, ci/, adr/
tools/register.mjs        runs the repo's own TypeScript from source (Flux can't load itself)
vitest.config.ts          the one Vitest config: unit, docker and e2e projects
vitest.setup.ts           every test run: files in memory (memfs), import() served from there
__mocks__/                Vitest automocks for fs, fs/promises and glob (must sit at the root)
tsconfig.json             one type-check config; extends tsconfig.paths.json, generated by
tsconfig.paths.json         pnpm forge paths so @decohere/* imports point at source. Don't edit
package.json              root scripts, dev tools, overrides; the only install (no pnpm workspace)
.changeset/               Changesets config for stable releases; no entries until the first
                          public release (ADR 0003)
.github/                  workflows/, actions/, ci/ (path filters), PR and issue templates,
                          CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md
.devcontainer/            the optional Dev Container
.claude/                  CLAUDE.md (imports AGENTS.md) and the commands Claude may run unasked
.vscode/                  editor settings and debug configurations
.node-version             the Node version CI and contributors use (24)
.oxlintrc.json, .prettierrc.json, .prettierignore   lint and format rules (ADR 0004)
```

Where to put what:

| Adding | Goes in |
|---|---|
| A package | `projects/<name>/`, or `projects/<group>/<name>/` beside its siblings; a row in [architecture](architecture/#packages) and in the [guide's package list](../guide/#packages) if apps use it |
| Code | Its package's `src/<subdomain>/`, in a file named `<thing>.<role>.ts` ([ADR 0027](adr/0027-code-design.md#names)) |
| A test | Beside the file it tests: `router.service.spec.ts` next to `router.service.ts` ([testing](testing/#where-tests-go-and-where-they-run)) |
| A how-to for tests in this repo | [testing/how-tos/](testing/how-tos/) |
| A recipe for apps | [guide/recipes/](../guide/recipes/) |
| A lasting decision | Its topic's record in [adr/](adr/), or a new one ([when](adr/#when-to-write-one)) |
| A root file | Only if a tool requires it there; add it to the map above |

Each page is for one audience: the [docs index](../README.md#where-a-new-page-goes) says which folder a page belongs in.

No package fully follows [ADR 0027](adr/0027-code-design.md) yet, so copy the samples in [style](style/#samples), not the nearest file. For folders, `http`'s subdomains (`routing/`, `auth/`, `openapi/`) are the model, but not its `.types.ts` and `.store.ts` files. `crucible`, `forge`, `scaffold` and `flux` are laid out by kind (`services/`, `models/`, `commands/`): don't copy that.
