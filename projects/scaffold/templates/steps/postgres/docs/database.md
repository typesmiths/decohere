# Database (Postgres)

## Roles

| Role | Env | Purpose |
|---|---|---|
| App | `{PREFIX}_DB_USER` | Runtime API (DML only in production) |
| Migrate | `{PREFIX}_DB_MIGRATE_USER` | Schema changes: `pnpm decohere db` commands, and migrations on start in development |
| Bootstrap | `postgres` | Create DB + roles when `bootstrap: true` (dev) |

`{PREFIX}` is the API slug in SCREAMING_SNAKE (`api` → `API`, `billing` → `BILLING`).

## No passwords locally

The local Postgres trusts every connection, so nothing here needs a password. `config/config.dev.yaml` declares this with `auth: trust`, and the app refuses that setting outside development. Its port is bound to `127.0.0.1`, so other machines can't connect, but anything on your machine or the Compose network can, so keep only development data in it.

Production still needs real passwords: `{PREFIX}_DB_PASSWORD` for the app, and `{PREFIX}_DB_MIGRATE_PASSWORD` for migrations.

## Changing the schema

Migrations live in `projects/<api>/src/migrations/`, listed in its `index.ts`. In development (`config/config.dev.yaml`, `migrateOnStart: true`) the API applies pending ones when it starts.

```bash
pnpm decohere db generate add-expiry          # write a migration from your mapping changes; read it, then restart
pnpm decohere db new backfill-expiry --data   # a migration that changes rows, written by hand
pnpm decohere db status
pnpm decohere db revert
```

With more than one API, name it: `pnpm decohere db status --api billing`. How it works, deploys, and changing a schema without downtime: https://github.com/typesmiths/decohere/blob/main/docs/recipes/migrations.md

## Production (migrations only)

`config/config.yaml` keeps `synchronize: false` / `seed: false` / `bootstrap: false`. Deploy steps:

1. Ensure the app database and roles already exist (provisioner / ops — not the API pod).
2. Run migrations as a release step, with the migrate role: `node es6/src/db.js migrate` in the packaged API, with `{PREFIX}_DB_MIGRATE_USER` and `{PREFIX}_DB_MIGRATE_PASSWORD` set.
3. Start the API with the app role only — no migrate/admin secrets on the pod.

## Scripts

| Script | What it does |
|---|---|
| `db:up` / `db:down` / `db:reset` | Local Compose Postgres |

## Browse the database

Prefer the Dev Container **SQLTools** extension (Postgres driver) or any desktop client against `127.0.0.1:5433`, as user `postgres` with no password.

Adminer is **not** scaffolded. If you want a browser UI in Compose, add this under `services:` in `.devcontainer/docker-compose.yml` (profile `tools` so it stays off by default):

```yaml
  adminer:
    image: adminer
    profiles:
      - tools
    ports:
      - "127.0.0.1:8081:8080"
    networks:
      - <compose-network-key> # same key as postgres / devcontainer
```

Then: `docker compose -f .devcontainer/docker-compose.yml --profile tools up -d adminer`
