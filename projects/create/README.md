# @decohere/create

Scaffold a new Decohere project — built with Forge, served with Flux.

Scaffolding always runs somewhere that already has its tools, so nothing gets installed on your machine.

| Where you run it | `create` | `add`, `auth0` |
|---|---|---|
| A Decohere Dev Container | Runs right there | Runs right there |
| Your machine, or another container with Docker access | Runs in the `ghcr.io/typesmiths/decohere/create` image, then copies the project out | Says to open the project's Dev Container |
| Another container with no Docker access | Says Docker is needed | Says to open the project's Dev Container |

The scaffolder image gets no folders from your machine, and it can't see `~/.npmrc` or your Auth0 login. It works in its own folder, and the project is copied out only if it succeeds, so a failed run or Ctrl-C leaves your folder as it was. The container is always removed. A new project needs an empty folder (a `.git` folder is fine). The image is the bare minimum, plain Alpine with Node, the scaffolder and the Auth0 CLI, so a new project gets formatted by Prettier the first time its Dev Container installs dependencies. Outside a Dev Container, run `pnpm lint` once after installing. This works the same from your machine, from inside a container, and against a remote Docker.

With Auth0 and Postgres, `create` also makes an admin user with a generated password. The password isn't printed or kept in the project, and it's only for logging in. On Linux with a key store (GNOME Keyring or KWallet, through `secret-tool`), it's saved there, and `create` prints the command to read it. Anywhere else it goes in `~/.config/decohere/<project>.env`, readable only by you. Run inside a container, that file is in the container, so copy it if the container may be rebuilt.

Choosing Auth0 during `create` means logging in there. That login goes away with the container, so your first `auth0` command in the Dev Container asks you to log in once more.

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
npm create @decohere@dev -- webapi -d my-app --database postgres/mikro-orm --auth none -y
```

Target directory is `webapi`'s optional argument or `-d` (default `.`). `npm create` treats `-d` as its own loglevel flag and forwards `my-app` as a positional — that form is supported. Extra create flags still need `--` after `npm create`.

A first token that isn't a command (`webapi`, `create`, `add`, `auth0`, `help`) or a flag is the project's folder, so a mistyped command starts a project with that name.

The scaffolded Dev Container asks no questions. `gh` is installed in it: run `gh auth login` yourself if you want it, and the login persists in `~/.config/decohere/gh/<project>/`, outside the project and readable only by you. Each project has its own, so a project can use a different GitHub account. To use a token instead, put `GH_TOKEN=…` in `~/.config/decohere/gh/<project>.env`.

## Commands

### `webapi`

Scaffolds a full web API using `@decohere/http` (HTTP), `@decohere/crucible` (DI), `@decohere/config` (configuration) and Scribe (logging), plus a Dev Container workspace.

What it writes is checked-in files, not code generated on the fly: the workspace every project starts with, then the **web API recipe**, a complete app on Fastify that the Decohere repo boots and tests as it is ([scaffold](../scaffold/README.md)). Only names and ports change. `--database` and `--auth` are the same [add steps](#add-to-a-project) you can run later, applied on top of the recipe.

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
  .oxlintrc.json
  .prettierrc.json
  .prettierignore
  pnpm-workspace.yaml   # tells pnpm not to run the SWC and esbuild install scripts
  .env
  config/
    config.yaml
    config.dev.yaml
  .devcontainer/
  projects/
    api/                # or projects/<name> when --name is set
      package.json      # private: true; "decohere" records the recipe and the steps added
      Dockerfile        # copies .package/ (written by `forge package`)
      .dockerignore
      src/
        app.ts          # createApp(): the app's composition and your services
        main.ts         # starts it
        sample.config.ts
        services/
          sample.service.ts
        controllers/
          hello.controller.ts
      tests/
        hello.controller.spec.ts  # GET /hello over HTTP, no database or Docker
```

Every API gets its own `projects/<name>/Dockerfile`; that folder is the Docker build context. The Dockerfile copies `.package/`, which `forge package` writes (see below).

The app Dev Container is a thin `FROM ghcr.io/typesmiths/decohere/devcontainer:<version>` (pinned to the scaffolder version). Shared layers (bash history, pnpm, `gh`, js-debug bootloader fix) update via `docker pull` / Dev Container rebuild — Compose mounts and lifecycle scripts stay in the app repo. Rebuild with pull after upgrading `@decohere/create`.

The base image is `node:24-trixie-slim`, with no compilers. If an npm package has to compile on install because it has no prebuilt binary, add what it needs to your project's `.devcontainer/Dockerfile`:

```dockerfile
USER root
RUN apt-get update && apt-get install -y --no-install-recommends g++ make python3 && rm -rf /var/lib/apt/lists/*
USER node
```

#### The app and its test

`src/app.ts` is the app's composition, written out so you can see and change every part: Pino logging, `http(FastifyProvider, …)` with an OpenAPI document, `config(…)` from `config/` and the environment, and `health()`. To use another HTTP provider or logger, edit that line; nothing is hidden behind a preset ([architecture: progressive](../../docs/architecture/README.md#4-progressive-new-apps-start-from-a-recipe-the-app-owns)). `src/main.ts` only starts it:

```ts
import { createApp } from "./app.js";

const app = await createApp();
await app.start({ port: Number(process.env.PORT ?? 3000) });
export default app;
```

`tests/hello.controller.spec.ts` boots the Hello controller as a real app on a free port and calls `GET /hello`, with no database, Auth0 or Docker, so `pnpm test` passes in a new project. Copy it for your own controllers; [Testing an app](../http/README.md#testing-an-app) shows how to test the whole app instead.

#### Scripts

| Script | Command | When |
|---|---|---|
| `build` | `forge build --configuration release` | CI, Nixpacks |
| `package` / `package:<name>` | release build, then `forge package` (all APIs, or that one) | Before `docker build` |
| `start` | `node dist/release/projects/<first>/es6/src/main.js` | Production default API (`pnpm start`) |
| `start:<name>` | same path for that API | Deploy that API (`pnpm run start:billing`) |
| `dev` | `PORT=3000 flux serve --env-file-if-exists .env --project @<app>/<first>` | Local HMR for the first API; loads `.env` if present |
| `dev:<name>` | `PORT=<3000+n> flux serve --env-file-if-exists .env --project @<app>/<name>` | Local HMR for that API |
| `lint` | `oxlint --fix`, then `prettier --write .`, skipping `.devcontainer` | Fix and format |
| `lint:check` / `typecheck` / `test` | oxlint and Prettier / forge typecheck / vitest | CI |

#### Add to a project

Each part a project can have is an add step. `create` runs the ones you choose on top of the recipe; in the project's Dev Container you can run any of them later:

```bash
pnpm decohere add api billing            # the web API recipe again, as projects/billing (asks for its steps)
pnpm decohere add postgres               # Postgres in the Dev Container, a database and sample table per API
pnpm decohere add postgres --orm typeorm # the same, mapped with TypeORM instead of MikroORM
pnpm decohere add auth0                  # Auth0: every route needs a token (see below)
pnpm decohere add users                  # with Postgres and Auth0: a local profile per user, admin seeded
```

| `create` option | Is the recipe, plus |
|---|---|
| `--database postgres/mikro-orm` | `add postgres` |
| `--database postgres/typeorm` | `add postgres --orm typeorm` |
| `--auth auth0` | `add auth0` |
| both | `add postgres`, `add auth0`, then `add users` |

Every step:

- **Adds, and never takes away.** A file the project doesn't have is copied in. One it has is merged: `package.json`, `devcontainer.json`, `docker-compose.yml` and `config/*.yaml` get only the keys and list items they lack (a data source by its `name`), `.env` only the variables it doesn't set, `.gitignore` only missing lines, `README.md` only missing `##` sections.
- **Changes nothing when run again.** `--dry-run` lists what it would change and writes nothing (and touches no Auth0 tenant).
- **Edits `app.ts` only in the shape it generated.** It inserts its lines (`.use(auth())` after `.use(config(…))`, the data provider before `.build()`, and so on). If one can't go in, it leaves the file as it is and prints every line to add.
- **Replaces a sample file only if you haven't touched it.** `add auth0` and `add users` rewrite `hello.controller.ts` and its test only while they are exactly what the recipe (or `add auth0`) wrote; otherwise they print where their version is.
- **Records itself** in the API's `package.json`, under `"decohere": { "recipe", "steps" }`.

`add api billing` adds `projects/billing`, `start:billing` / `package:billing` / `dev:billing`, its port in the Dev Container, and `projects/billing/Dockerfile`. It doesn't rewrite the first API or workspace files like `.prettierrc.json`. From an empty machine, `npx @decohere/create webapi add billing -d my-app` does the same.

Each API is a separate deploy: package it (`pnpm run package:billing`) and build the image from its folder (`docker build projects/billing`), or set the start command to `pnpm run start:billing`. Workspace `config/` is shared; each API still has its own named datasource and `{PREFIX}_DB_*` env (host/port default to the Compose Postgres).

### `auth0`

Run these in the project's Dev Container, which has the Auth0 CLI. Each project keeps its login in its own folder on your machine: `$XDG_RUNTIME_DIR/decohere-auth0/<project>` on Linux, which is held in memory and readable only by you, and `~/.config/decohere/decohere-auth0/<project>` elsewhere. Rebuilding the Dev Container doesn't log you out, but logging out of your machine or rebooting does on Linux. `configure` and `add auth0` stop if you're logged in to a different tenant from the one in `.env`. Use this after a project exists, when a token expires, or when the login app needs to be created or updated.

```bash
# Device/URL login — open the printed URL in your browser
pnpm decohere auth0 login

# Update the Auth0 API, login app and token app for this workspace
pnpm decohere auth0 configure

# Print a token for calling the API in development
pnpm decohere auth0 token
```

`configure` does **not** rewrite application source. It ensures a `<project> Dev` login app for your web app (written to `.env` as `AUTH0_CLIENT_ID`, and allowing `http://localhost:<port>` for each API), scans `projects/*/src` for `@Authorize("action", "Subject")`, adds those permissions to the Auth0 API (keeping any already on the API) and assigns them to `AUTH0_ADMIN_USER_SUB` when set.

#### Add Auth0 to an existing project

In the project's Dev Container:

```bash
pnpm decohere add auth0
```

This logs in if needed, creates the Auth0 API and a `<project> Dev` login app, writes `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE` and `AUTH0_CLIENT_ID` to `.env`, adds the `auth` section to `config/config.yaml`, and adds `.use(auth())` to each API's `app.ts`. It gives the Hello controller `@Authorize` permissions and its test a token check of its own. It also creates a `<project> Token` machine app (written to `.env` as `AUTH0_TOKEN_CLIENT_ID`). With Postgres too, `pnpm decohere add users` adds the local user profile a new project with both gets; with `DECOHERE_ADMIN_PASSWORD` set, it also creates the admin user on Auth0.

Once Auth0 is added, **every route needs a token** unless it has `@AllowAnonymous()`, because `auth()` is secure by default. To call one, in the Dev Container:

```bash
curl -H "Authorization: Bearer $(pnpm -s decohere auth0 token)" localhost:3000/hello/1
```

`auth0 token` prints a short-lived token from the machine app, with no browser, and it's allowed every permission on the API. Keep it to development. Your Auth0 login has to be current, because the Auth0 CLI fetches the token.

#### Keep Auth0 in sync with controllers

`@Authorize("read", "Invoice")` becomes Auth0 API permission `read:Invoice`. After adding a controller:

```bash
pnpm decohere auth0 configure
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
| `postgres/mikro-orm` | One Compose Postgres **instance**; each API owns a named database + `{PREFIX}_DB_*` env, mapped with MikroORM |
| `postgres/typeorm` | The same, mapped with TypeORM |

```bash
npx @decohere/create webapi -d my-app --database postgres/mikro-orm
npx @decohere/create webapi -d my-app --name api --name billing --database postgres/mikro-orm
```

`config.yaml` lists one datasource per API (`name: billing` → `mikroOrm({ name: "billing" })`). Locally they share host `postgres` port `5432`. Point `BILLING_DB_HOST` / `BILLING_DB_PORT` at another server to split later. `webapi add billing --database postgres/mikro-orm` appends a datasource; the bootstrap `CREATE DATABASE`s it on first run.

Each API builds in `src/app.ts` (`createApp()`) and starts in `src/main.ts`. Its migrations are in `src/migrations/`, starting with one per table the scaffold maps, and development applies them on start. `pnpm decohere db <command>` runs `src/db.ts` (add `--api billing` when there are several APIs): `generate <name>` writes a migration from your mapping changes, and `migrate`, `status`, `revert` and `new` do what they say. See [Migrations](../../docs/recipes/migrations.md).

#### Health probes

Scaffolded APIs call `.use(health())` so these routes are available **without auth**:

| Route | Purpose | Status |
|---|---|---|
| `GET /health` | Liveness — process is up | Always `200` `{ "status": "ok" }` |
| `GET /ready` | Readiness — dependencies OK | `200` when checks pass; `503` when a check fails |

With a database, readiness checks each data source's connection. Use `/ready` for load balancers and orchestrators.

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

#### Try the API

While the API is running, `http://localhost:3000/openapi.json` describes every route.

## Options

| Option | Scope | Description |
|---|---|---|
| `[directory]` / `-d <directory>` | `webapi` / global | Target directory (positional wins; default `.`) |
| `--name <slug>` | `webapi` | API directory under `projects/` (repeatable; default `api`) |
| `add api <name>` | `decohere add api` | Add an API to an existing Decohere workspace |
| `add auth0` | `decohere add auth0` | Add Auth0 to an existing workspace |
| `auth0 login` | `decohere auth0` | Device/URL login; keeps tokens in `~/.config/auth0` |
| `auth0 configure` | `decohere auth0` | Update the Auth0 API, login app and token app for an existing workspace |
| `auth0 token` | `decohere auth0` | Print an access token for calling the API in development |
| `--database <provider>` | `webapi` / `add` | `none` \| `postgres/mikro-orm` \| `postgres/typeorm` |
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
