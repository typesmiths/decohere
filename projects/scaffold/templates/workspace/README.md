# workspace-name

A Decohere workspace, created with [`@decohere/create`](https://www.npmjs.com/package/@decohere/create). Each app lives in `projects/<name>/`, and `src/app.ts` spells out what it is made of.

## Get started

1. Open this folder in VS Code / Cursor.
2. **Reopen in Container** (or rebuild the Dev Container).
3. Install dependencies if needed:

```bash
pnpm install
```

## Develop

```bash
pnpm dev                  # Flux HMR for the first app
pnpm run dev:<name>       # HMR for one app
pnpm start                # run the compiled first app
pnpm run start:<name>     # run one compiled app
pnpm run build            # forge release build
pnpm run package          # release build + .package/ for each app (what Docker copies)
pnpm test                 # each app's tests/
```

## Logging

In development, Scribe uses pino-pretty and rolling files under `logs/` (gitignored).
When `NODE_ENV=production`, the process writes structured JSON to stdout and does not rotate files.
Ship and retain those streams outside the app (platform logs, a sidecar, or a log agent) so shipping can change without rebuilding.

Override roll path and rotation without changing app code:
`SCRIBE_LOG_FILE`, `SCRIBE_LOG_SIZE`, `SCRIBE_LOG_FREQUENCY`, `SCRIBE_LOG_KEEP`.

Opt into in-process pretty or roll in production only with `{ when: "always" }` on `scribe.withPinoPretty` / `scribe.withPinoRoll`.

## Deploy

Each app has its own `projects/<name>/Dockerfile`. It copies `.package/`, which `forge package`
writes before Docker runs: the app's compiled code, the workspace libraries it imports, and
a plain `node_modules` of the third-party packages it uses (no symlinks). The image build
installs nothing and needs no npm token.

```bash
pnpm run package:<name>   # release build, then .package/ in that app
docker build -t workspace-name projects/<name>
```

A host that builds from a git clone does not have `.package/`; build and push the image
from CI instead (`forge docker` after `pnpm run package`).

## Add to it

Each command changes only what it needs, says what to change by hand when a file no longer has the shape it generated, and changes nothing when run again. `--dry-run` lists what it would change.

```bash
pnpm decohere add api <name>        # another web API, in projects/<name>/
pnpm decohere add postgres          # Postgres with MikroORM (--orm typeorm for TypeORM)
pnpm decohere add auth0             # Auth0 sign-in: every route needs a token
pnpm decohere add users             # with Postgres and Auth0: a local profile for each user
```

## Try the API

While a web API is running, `http://localhost:3000/openapi.json` describes every route.
