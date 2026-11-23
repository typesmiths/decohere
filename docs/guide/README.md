# Using Decohere

For developers building apps and tools with Decohere. Changing Decohere itself? See [contributing](../contributing/).

| Question | Answer |
|---|---|
| What is Decohere, and how does it compare with NestJS and Nx? | [Why Decohere](why-decohere.md) |
| How do I go from an empty folder to a running API? | [Getting started](getting-started.md) |
| How do I do one specific thing (run a TypeScript file, publish a package, keep secrets out of files)? | [Recipes](recipes/) |
| How do I change a database schema, and run migrations when I deploy? | [Migrations](recipes/migrations.md) |
| What does a package do, and what are its options? | The package's README |

## Packages

| Package | For |
|---|---|
| [`@decohere/create`](../../projects/create/README.md) | Scaffolding an API: `pnpm create @decohere webapi` |
| [`@decohere/cli`](../../projects/cli/README.md) | The `forge`, `flux` and `decohere` commands in one install |
| [`@decohere/flux`](../../projects/flux/README.md) | Running TypeScript from source, with reload on save |
| [`@decohere/forge`](../../projects/forge/README.md) | Building, packaging and publishing a workspace |
| [`@decohere/workspace`](../../projects/workspace/README.md) | How Forge and Flux find a workspace's packages |
| [`@decohere/core`](../../projects/core/README.md) | The app builder, hosted services, health and readiness |
| [`@decohere/crucible`](../../projects/crucible/README.md) | Dependency injection |
| [`@decohere/config`](../../projects/config/README.md) | Configuration from YAML files and the environment |
| [`@decohere/scribe`](../../projects/scribe/README.md) | Structured logging, with [Pino](../../projects/scribe/scribe-pino/README.md) and [console](../../projects/scribe/scribe-console/README.md) providers |
| [`@decohere/http`](../../projects/http/README.md) | Controllers, routing, auth, OpenAPI, errors as problem details |
| [`@decohere/http-fastify`](../../projects/http-fastify/README.md) | The Fastify server behind `http` |
| [`@decohere/data`](../../projects/data/data/README.md) | Unit of work, repositories, migrations |
| [`@decohere/data-mikro-orm`](../../projects/data/data-mikro-orm/README.md), [`data-typeorm`](../../projects/data/data-typeorm/README.md) | The ORM behind `data` |
| [`@decohere/data-postgres`](../../projects/data/data-postgres/README.md) | Setting up Postgres at startup and running migrations |
| [`@decohere/data-memory`](../../projects/data/data-memory/README.md) | `data` in memory, for tests and prototypes |
| [`@decohere/testing`](../../projects/testing/README.md) | Helpers for testing an app |
