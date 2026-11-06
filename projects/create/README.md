# @decohere/create

Scaffold a new Decohere project — built with Forge, served with Flux.

Docker is required on the host. `@decohere/create` only pulls `ghcr.io/typesmiths/decohere/create` and runs `@decohere/scaffold` inside it (including the Auth0 CLI). It does not install the scaffolder libraries on the host.

## Usage

`npm create` already says “create”, so the first token is the kind (`webapi`), not `create` again. `webapi` is the only kind today, so you can leave it out and give just the project's folder. The launcher forwards `decohere create webapi …` into the builder image.

This run prompts for database and auth:

```bash
npm create @decohere@dev my-app
# or
npm create @decohere@dev webapi -d my-app
# or
npx @decohere/create@dev webapi -d my-app
# or, once `@decohere/cli` is installed:
decohere create webapi -d my-app
```

To skip prompts, pass every answer up front (`-y` means “install deps, don’t ask”):

```bash
npm create @decohere@dev -- webapi -d my-app --database postgres/typeorm --auth none -y
```

Target directory is `webapi`'s optional argument or `-d` (default `.`). `npm create` treats `-d` as its own loglevel flag and forwards `my-app` as a positional — that form is supported. Extra create flags still need `--` after `npm create`.

A first token that isn't a command (`webapi`, `create`, `add`, `auth0`, `help`) or a flag is the project's folder, so a mistyped command starts a project with that name.

The scaffolded Dev Container asks no questions. `gh` is installed in it: run `gh auth login` yourself if you want it, and the login persists in `.devcontainer/gh-auth/` (gitignored).

## Commands

### `webapi`

Scaffolds a full web API using `@decohere/http` (HTTP), `@decohere/crucible` (DI), `@decohere/config` (configuration) and Scribe (logging), plus a Dev Container workspace.

```bash
npx @decohere/create webapi -d my-app
npx @decohere/create webapi -d my-app --name billing
npx @decohere/create webapi -d my-app --name api --name billing
```

Generated structure (default `--name api`):

```
my-app/
  package.json          # build / start / start:<name> / dev
  .github/
    actions/setup-node-pnpm/
    workflows/
      ci.yml            # lint ∥ test (+ build and package on default branch)
      publish.yml       # forge publish (skips private); no docker push by default
  tsconfig.json
  biome.json
  pnpm-workspace.yaml   # tells pnpm not to run the SWC and esbuild install scripts
  .env
  config/
    config.yaml
    config.dev.yaml
  .devcontainer/
  projects/
    api/                # or projects/<name> when --name is set
      package.json      # private: true (app, not an npm package)
      Dockerfile        # copies .package/ (written by `forge package`)
      .dockerignore
      src/
        main.ts
        sample.config.ts
        sample.service.ts
        controllers/
          hello.controller.ts
```

Every API gets its own `projects/<name>/Dockerfile`; that folder is the Docker build context. The Dockerfile copies `.package/`, which `forge package` writes (see below).

The app Dev Container is a thin `FROM ghcr.io/typesmiths/decohere/devcontainer:<version>` (pinned to the scaffolder version). Shared layers (bash history, pnpm, `gh`, js-debug bootloader fix) update via `docker pull` / Dev Container rebuild — Compose mounts and lifecycle scripts stay in the app repo. Rebuild with pull after upgrading `@decohere/create`.

#### Scripts

| Script | Command | When |
|---|---|---|
| `build` | `forge build --configuration release` | CI, Nixpacks |
| `package` / `package:<name>` | release build, then `forge package` (all APIs, or that one) | Before `docker build` |
| `start` | `node dist/release/projects/<first>/es6/src/main.js` | Production default API (`pnpm start`) |
| `start:<name>` | same path for that API | Deploy that API (`pnpm run start:billing`) |
| `dev` | `flux serve --env-file-if-exists .env` (plus `--project @<app>/<first>` when named) | Local HMR for the first API; loads `.env` if present |
| `dev:<name>` | `PORT=<3000+n> flux serve --env-file-if-exists .env --project @<app>/<name>` | Local HMR for that API |
| `lint:check` / `typecheck` / `test` | biome / forge typecheck / vitest | CI |

#### Multiple APIs / add later

```bash
decohere add api billing
# empty machine / npm create still maps `webapi add`:
npx @decohere/create webapi add billing -d my-app
```

Adds `projects/billing`, `start:billing` / `package:billing` / `dev:billing`, and `projects/billing/Dockerfile`. Does not rewrite the first API or workspace files like `biome.json`.

Each API is a separate deploy: package it (`pnpm run package:billing`) and build the image from its folder (`docker build projects/billing`), or set the start command to `pnpm run start:billing`. Workspace `config/` is shared; each API still has its own named datasource and `{PREFIX}_DB_*` env (host/port default to the Compose Postgres).

### `auth0`

The Auth0 CLI lives in the create image. Host tokens are stored in `~/.config/auth0` (always bind-mounted). Use this after a project exists, when a token expires, or when the Postman SPA needs to be created/updated.

```bash
# Device/URL login — open the printed URL in your browser
npx @decohere/create auth0 login

# Update the Auth0 API and login app for this workspace (run from the project, or pass -d)
npx @decohere/create auth0 configure
npx @decohere/create auth0 configure -d my-app

# Same commands once `@decohere/cli` is installed:
decohere auth0 login
decohere auth0 configure
```

`configure` does **not** rewrite application source. It ensures a `<project> Dev` login app (written to `.env` as `AUTH0_CLIENT_ID`), scans `projects/*/src` for `@Authorize("action", "Subject")`, adds those permissions to the Auth0 API (keeping any already on the API) and assigns them to `AUTH0_ADMIN_USER_SUB` when set.

#### Add Auth0 to an existing project

```bash
decohere add auth0
```

This logs in if needed, creates the Auth0 API and a `<project> Dev` login app, writes `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE` and `AUTH0_CLIENT_ID` to `.env`, adds the `auth` section to `config/config.yaml`, and adds `.withAuth()` to each API's `main.ts`. Running it again changes nothing. If a `main.ts` no longer has the generated shape, the command leaves it alone and prints the lines to add. It doesn't protect any routes for you, and it doesn't add the local user profile a new project with Postgres gets.

#### Keep Auth0 in sync with controllers

`@Authorize("read", "Invoice")` becomes Auth0 API permission `read:Invoice`. After adding a controller:

```bash
npx @decohere/create auth0 configure
```

Then get a new access token so it includes the new permissions.

#### Deploy (Railway / Fly / Nixpacks)

The production image does not install or build anything: it copies `.package/`, the folder `forge package` writes inside the API project (the API's compiled code, the workspace libraries it imports, and a plain `node_modules` of the third-party packages it uses, with no symlinks). Run `pnpm run package` (or `package:<name>`) first, then `docker build projects/<name>`.

1. **CI builds the image (preferred):** run `pnpm run package`, then `pnpm exec forge docker --configuration release --push`. Private `@decohere/*` packages need npm auth only in that package step, never in the image build.
2. **Hosts that build from a git clone** (Railway, Fly) do not have `.package/`, because it is build output. Build the image in CI and deploy it, or run the package step before `docker build`.
3. **Nixpacks (no Dockerfile):** conventional `build` / `start` scripts — install → build → start.

Commit `pnpm-lock.yaml` after the first install.

**Registry push (optional):** CI does not run `forge docker --push` by default. For Cloud Run / K8s, add `pnpm run package` and that step to `publish.yml` after configuring GHCR.

**Conventions:** `"private": true` → skip npm publish; presence of a Dockerfile → dockerizable; non-private packages under `projects/` → `forge publish`.

#### Database (`--database`)

| Value | Effect |
|---|---|
| `none` | No database |
| `postgres/typeorm` | One Compose Postgres **instance**; each API owns a named database + `{PREFIX}_DB_*` env |

```bash
npx @decohere/create webapi -d my-app --database postgres/typeorm
npx @decohere/create webapi -d my-app --name api --name billing --database postgres/typeorm
```

`config.yaml` lists one datasource per API (`name: billing` → `withTypeOrm({ name: "billing" })`). Locally they share host `postgres` port `5432`. Point `BILLING_DB_HOST` / `BILLING_DB_PORT` at another server to split later. `webapi add billing --database postgres/typeorm` appends a datasource; TypeORM bootstrap `CREATE DATABASE`s it on first run.

#### Health probes

Scaffolded APIs call `.withHealth()` so these routes are available **without auth**:

| Route | Purpose | Status |
|---|---|---|
| `GET /health` | Liveness — process is up | Always `200` `{ "status": "ok" }` |
| `GET /ready` | Readiness — dependencies OK | `200` when checks pass; `503` when a check fails |

With `--database postgres/typeorm`, readiness runs `SELECT 1` against each TypeORM datasource. Use `/ready` for load balancers and orchestrators.

#### Auth (`--auth`)

| Value | Effect |
|---|---|
| `none` | No auth |
| `auth0` | Auth0 JWT protection; with Postgres also scaffolds a local User profile |

```bash
npx @decohere/create webapi -d my-app --auth auth0
```

With Auth0 + Postgres, customize authorization in `projects/<api>/src/auth/ability.factory.ts`:
override `defineAbilitiesFor` for product CASL rules, and `mapPrincipal` for IdP claim mapping
(including the `AUTH0_ADMIN_USER_SUB` admin bootstrap). `@decohere/http`'s default already maps
`admin` → `manage`/`all` and `action:Subject` scopes.

#### Postman

While the API is running, choose Import in Postman and paste `http://localhost:3000/openapi.json`. Import it again after you change a route.

## Options

| Option | Scope | Description |
|---|---|---|
| `[directory]` / `-d <directory>` | `webapi` / global | Target directory (positional wins; default `.`) |
| `--name <slug>` | `webapi` | API directory under `projects/` (repeatable; default `api`) |
| `add api <name>` | `decohere add api` / `npx @decohere/create webapi add` | Add an API to an existing Decohere workspace |
| `add auth0` | `decohere add auth0` / `npx @decohere/create add auth0` | Add Auth0 to an existing workspace |
| `auth0 login` | `decohere auth0` / `npx @decohere/create auth0` | Device/URL login; persist tokens in `~/.config/auth0` |
| `auth0 configure` | `decohere auth0` / `npx @decohere/create auth0` | Update the Auth0 API and login app for an existing workspace |
| `--database <provider>` | `webapi` / `add` | `none` \| `postgres/typeorm` |
| `--auth <provider>` | `webapi` / `add` | `none` \| `auth0` |
| `-y, --yes` | `webapi` / `add` | Install dependencies without prompting |
| `--install <mode>` | `webapi` / `add` | `ask` (default) \| `yes` \| `no` |

## Next steps

After scaffolding:

```bash
cd my-app
code .          # open in VS Code / Dev Container
pnpm build      # forge release build
pnpm start      # run compiled API (production)
pnpm dev        # Flux HMR (development)
```

## Troubleshooting

### GHCR pull fails with `403 Forbidden`

If scaffolding fails with an error like:

```text
failed to resolve reference "ghcr.io/typesmiths/decohere/create:<version>": ... 403 Forbidden
```

your GitHub token likely does not include the `read:packages` scope.

1. Create or use a token with at least `read:packages`.
2. If the package is private/internal, also include `repo`.
3. Re-login to GHCR and retry.

```bash
export GH_TOKEN=YOUR_PAT_WITH_READ_PACKAGES
echo "$GH_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
docker pull ghcr.io/typesmiths/decohere/create:<version>
```

You can verify scopes with:

```bash
gh auth status -t
```

If you still get `403` after adding `read:packages`, ask an org admin to grant your user/team access to the `typesmiths/decohere/create` package.
