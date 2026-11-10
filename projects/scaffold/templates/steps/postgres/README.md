## Database

Postgres runs via Dev Container Compose:

```bash
pnpm db:up
pnpm db:down
pnpm db:reset
```

Migrations live in each app's `src/migrations/`, and development applies them on start:

```bash
pnpm decohere db generate add-expiry   # a migration from your mapping changes; read it, then restart
pnpm decohere db status
```

More in [docs/database.md](docs/database.md).
