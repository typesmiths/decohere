# Contributing

From picking up a task to merging it. Where files go: the [repo map](../README.md#repo-map). Coding agents follow [AGENTS.md](../../AGENTS.md), which points here.

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
| `pnpm test:file <path>` | One test file, e.g. `pnpm test:file projects/crucible/tests/registration.spec.ts` (no `--`) |
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
3. **Change.**
   - Bugs: a failing test first, then the fix, then the same test again.
   - Test behaviour, not wiring ([testing](../testing/)).
   - A lasting design choice updates its [ADR](../adr/), and [architecture](../architecture/) or [style](../style/), in the same PR.
   - Changed a `package.json`? Run `pnpm install` and commit `pnpm-lock.yaml`.
   - No changesets for now ([ADR 0003](../adr/0003-no-changesets-until-public-release.md)).
   - Before pushing: `pnpm run lint && pnpm run typecheck && pnpm test`.
4. **Pull request.** Push and open one early (`gh pr create --fill --draft`). The template asks for the problem, what changed and how we know it works: write it for someone new to the code, and end with `Closes #<issue>`. Mark it ready when CI is green.
5. **Merge.** Click merge. Once `ci` passes, the PR joins `main`'s merge queue: GitHub tests it on top of `main` and the PRs ahead of it, then squash-merges it. If that run fails, the PR leaves the queue and `main` is untouched. No need to update branches by hand.
6. **Clean up.** `git switch main && git pull`, then `git branch -D <branch>` (squash merges don't look merged to git) and `git worktree remove ../decohere-<issue>` if you used one.

## CI

Every PR and merge-queue run does lint, typecheck, unit tests and a package check. A PR also builds the images or runs the Docker tests when those files change. A PR that only touches docs (nothing in [`code-paths-filter.yml`](../../.github/ci/code-paths-filter.yml)) skips them. `main` is the integration run: images, Docker tests, coverage and a real install, so a break there stops publishing. A merge to `main` publishes a dev release. Details: [CI and release](../ci/).

## Adding a package

You can propose a new package without any npm access. A package's first publish needs an owner's npm login, so an owner does it: see [Adding a new npm package](../ci/#adding-a-new-npm-package).
