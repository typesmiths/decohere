# Decohere

TypeScript framework for Node.js backends: a fast SWC compiler (forge), a JIT runner with HMR (flux), dependency injection (crucible) and logging (scribe), on support libraries named for what they do: `core`, `http`, `config`, `data` and `workspace` ([ADR 0014](docs/adr/0014-package-names.md)), with `devkit` and `testing` for the tools and tests themselves ([ADR 0015](docs/adr/0015-core-devkit-testing.md)). Packages live in `projects/`.

These are the instructions for every coding agent on this repo ([ADR 0009](docs/adr/0009-agent-instructions-in-agents-md.md)). `.claude/CLAUDE.md` only imports this file; keep agent-specific copies out.

Start at [docs/](docs/README.md): a map of the handbook and where every file goes. Before changing code, read [architecture](docs/architecture/), [style](docs/style/), [testing](docs/testing/), and the `README.md` of each package you change: it says how that package behaves, and a change must keep to it or update it in the same PR. The plan is the GitHub milestones.

## Commands

```bash
pnpm install
pnpm test                          # unit tests: no build, Docker, network, or tokens
pnpm test:docker                   # *.docker.spec.ts suites (need a Docker daemon)
pnpm test:file <path/to/x.spec.ts> # one file (no "--")
pnpm test:watch
pnpm run lint                      # oxlint --fix, then prettier --write
pnpm run typecheck
pnpm forge <command>               # forge CLI from source
pnpm flux run <file.ts>            # run TypeScript from source
```

## Hard rules

Each links to the record that says why. Read it before changing the area.

- **Secrets come only from the process environment** ([ADR 0002](docs/adr/0002-secrets-from-the-environment.md)). No package reads a `.env` file on its own; loading one is an explicit `--env-file` flag on a CLI. Never print secret values or commit them.
- **Keep the product pure of its host** ([architecture §1](docs/architecture/README.md#1-keep-the-product-pure-of-its-host)). No `process.env.VITEST`, `NODE_ENV === "test"` or `CI` branches in library or domain code, and library modules have no side effects on import.
- **A changed decision updates its ADR in the same PR** ([ADR 0001](docs/adr/0001-record-architecture-decisions.md)): rewrite what no longer holds and add a dated History line, never a quiet edit.

## Workflow

GitHub issues and milestones are the only tracker. The full flow: [contributing](docs/contributing/#how-work-flows).

- One issue → one branch `<type>/<issue#>-<slug>` → one PR whose body says `Closes #N`. Closely related issues can share a branch and PR when they touch the same code or one needs the other: name the branch for the main issue and list each in the body (`Closes #N`, `Closes #M`).
- PR descriptions follow `.github/pull_request_template.md`: the problem, what changed, how we know it works, in plain language for someone new to the code.
- Bug fixes: write the failing test first, then fix, then rerun the same test.
- Durable design choices get an ADR in `docs/adr/`: one record per topic, so check [the index](docs/adr/README.md) and update the existing record before adding a new one.
- No changesets for now ([ADR 0003](docs/adr/0003-no-changesets-until-public-release.md)). Don't add `.changeset/` files or the `skip-changeset` label.

## Working rules

- Don't run the linter or tsc after every edit. Before committing: `pnpm run lint:check && pnpm run typecheck && pnpm test` (`pnpm run lint` fixes what it can).
- Never silence an error to get past it: no empty `catch`, no error listener that only logs and carries on, no `any` or `@ts-expect-error` to turn a check green. If a fix seems to need one, stop and ask.
- If the same kind of attempt fails 3 times with no progress, stop and ask instead of guessing a new approach.
- Debug CI from real run logs (`gh run view <id> --log-failed`), not by running workflows locally.
- Move `latest` with the [Promote to latest](docs/ci/README.md#promote-to-latest) workflow. Anything else on npm by hand uses the owner's browser login and one OTP code, never an access token: follow [Changing npm by hand](docs/ci/README.md#changing-npm-by-hand).
