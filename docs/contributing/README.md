# Contributing

How we work on this repo, from picking up a task to merging it. Coding agents follow [AGENTS.md](../../AGENTS.md), which points here.

Related: [architecture](../architecture/), [decisions (ADRs)](../adr/), [testing](../testing/), [CI and release](../ci/).

## Set up

You need Node 24 (see `.node-version`) and pnpm. `corepack enable` gives you the pnpm version pinned in `package.json`. There is no npm login, `.env` file or setup script.

```bash
git clone https://github.com/typesmiths/decohere.git
cd decohere
pnpm install
pnpm test
```

**Dev Container (optional).** "Reopen in Container" uses `.devcontainer/devcontainer.json` on its own and installs dependencies the first time it starts. Log in once per machine with `gh auth login` (or export `GH_TOKEN` before opening) and sign in to your agent. Both logins are kept in shared Docker volumes, so they survive rebuilds and every checkout uses them.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests. No build, Docker, network or tokens needed |
| `pnpm test:file <path>` | One test file, e.g. `pnpm test:file projects/crucible/tests/registration.spec.ts` (no `--`) |
| `pnpm test:watch` | Re-run tests as you save |
| `pnpm test:docker` | Tests that need Docker, e.g. a real Postgres (`*.docker.spec.ts`). CI runs these too |
| `pnpm run test:coverage` | Unit tests with coverage |
| `pnpm run test:e2e` | End-to-end smoke tests of the built CLIs and the scaffolder |
| `pnpm run lint` | Fix lint with oxlint and format with Prettier (`lint:check` to check only) |
| `pnpm run typecheck` | TypeScript type check |
| `pnpm forge <command>` | Run the forge CLI from source (build, publish, …) |
| `pnpm flux run <file.ts>` | Run any TypeScript file from source |
| `pnpm run forge:build` | Build every package into `dist/` (only needed for e2e tests or debugging built output) |

Tests and the CLIs run straight from the TypeScript in `projects/`. [`tools/register.mjs`](../../tools/register.mjs) compiles files as Node loads them, so nothing has to be built first.

## What is at the repo root

Each entry has a reason to be here. If you add one, add its reason; if the reason stops being true, remove the entry.

| Entry | Why it is here |
|---|---|
| `projects/` | Every package and its tests. |
| `docs/` | Architecture, style, testing, contributing, ADRs. |
| `test/` | Vitest setup files that every test run loads (in-memory `fs`, module load hook). |
| `tools/register.mjs` | Lets Node run this repo's own TypeScript from source. Flux cannot load itself before it is compiled. |
| `__mocks__/` | Vitest's automatic `fs`, `fs/promises` and `glob` mocks, picked up by `vi.mock` in `test/`. |
| `.changeset/` | Pending release notes ([Changesets](https://github.com/changesets/changesets)). |
| `.devcontainer/` | The optional Dev Container. |
| `.github/` | CI workflows, composite actions, the PR and issue templates, `CONTRIBUTING.md` (points here), `SECURITY.md` (how to report a vulnerability) and `CODE_OF_CONDUCT.md`. GitHub reads all three from this folder. |
| `.claude/` | `CLAUDE.md`, which imports `AGENTS.md` for Claude Code, and `settings.json`, the commands it may run without asking. |
| `.vscode/` | Editor settings and three debug configurations. |
| `.node-version` | The Node version CI and contributors run (24). `engines.node` in `package.json` is the oldest version the packages support. |
| `.oxlintrc.json`, `.prettierrc.json`, `.prettierignore` | Lint and format rules ([ADR 0004](../adr/0004-oxlint-and-prettier.md)). |
| `tsconfig.json`, `tsconfig.paths.json` | One type-check config for the repo. It extends `tsconfig.paths.json`, which `pnpm forge paths` generates from the workspace packages so every `@decohere/*` import points at source; `pnpm run lint:check` fails if it is out of date. Don't edit it by hand. |
| `vitest.config.ts` | The only Vitest config: `unit`, `docker` and `e2e` projects. |
| `package.json`, `pnpm-lock.yaml` | Root scripts, dev tools, dependency overrides. |
| `AGENTS.md` | Instructions for coding agents ([ADR 0009](../adr/0009-agent-instructions-in-agents-md.md)). |

## How work flows

GitHub is the only tracker: issues, milestones and pull requests. The plan is the milestones.

### 1. Start from an issue

Every change starts as a GitHub issue in a milestone. If there isn't one, open it first. Explain the problem, the proposed fix, and what "done" looks like. Label its size: `size: S`, `size: M` or `size: L`.

Title format: `<type>(<area>): <short summary>`, e.g. `fix(http): cache remote JWKS`.

Types: `feat` · `fix` · `docs` · `test` · `refactor` · `chore`.

### 2. Branch

One issue, one branch, one pull request. Branch from the latest `main`:

```bash
git fetch origin main
git switch -c <type>/<issue>-<slug> origin/main   # e.g. fix/512-cache-jwks
```

Working on several things at once? Use a worktree per branch so they don't interfere:

```bash
git worktree add ../decohere-<issue> -b <type>/<issue>-<slug> origin/main
```

If a pull request for the issue is already open, keep committing to it rather than opening another.

### 3. Make the change

- **Bugs:** write a test that fails first, fix the code, then run the same test again.
- **Design decisions that should last:** add an ADR in [`docs/adr/`](../adr/) and update `docs/architecture/` or `docs/style/` in the same PR.
- **Prefer behaviour tests:** test what the code does, not how it's wired. See [testing](../testing/).
- **Changed a `package.json`?** Run `pnpm install` and commit `pnpm-lock.yaml`.
- **Changesets:** not yet. Nothing is released publicly, so there is nothing to version. We start using them at the first public npm release ([ADR 0003](../adr/0003-no-changesets-until-public-release.md)).

Before you push:

```bash
pnpm run lint && pnpm run typecheck && pnpm test
```

### 4. Open a pull request

Push and open a PR early (a draft is fine):

```bash
git push -u origin HEAD
gh pr create --fill --draft
```

The description template asks for three things: **the problem**, **what changed**, and **how we know it works**. Write it for someone who doesn't know this part of the code: explain the reasoning in plain language, not just a list of edits. End with `Closes #<issue>` so merging closes the issue.

Mark it ready for review when CI is green.

### 5. Merge and clean up

The `ci` check must pass before merging. Branches don't have to be up to date with `main`, so open PRs can be merged in any order. `main` runs CI again after every merge.

After merging:

```bash
git switch main && git pull
git branch -d <branch>
git worktree remove ../decohere-<issue>   # if you used one
```

## CI in one paragraph

Every pull request, from a branch here or from a fork, runs lint, typecheck, unit tests, Docker-backed tests and a Docker image build, and so does every push to `main` and `release`. A change that only touches docs (anything outside [`code-paths-filter.yml`](../../.github/ci/code-paths-filter.yml)) skips the code jobs. Merges to `main` also version and publish the packages. Details: [CI and release](../ci/).
