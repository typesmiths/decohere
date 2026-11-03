# Recipes

Small, outcome-first ways to use Decohere. These examples use only the part of the toolchain they need—no framework or scaffold unless the outcome calls for one.

This index is a starting point. More recipes and use cases are TODO.

## Run a TypeScript script

Install the [CLI](../../projects/cli/) in any directory:

```bash
mkdir hello
cd hello
pnpm init
pnpm add -D @decohere/cli
```

Create a raw TypeScript file:

```ts
// hello.ts
const name = process.argv[2] ?? "world";
console.log(`hello ${name}`);
```

Run it directly with [Flux](../../projects/flux/README.md):

```bash
pnpm exec flux run hello.ts -- Ada
# hello Ada
```

There is no scaffold, pre-build, or Decohere API framework in this path. Flux transpiles the file with [Forge](../../projects/forge/README.md)'s SWC pipeline, runs it, and forwards arguments after `--`.

## Keep secrets out of files (Bitwarden)

Decohere reads settings from environment variables, and never from a `.env` file unless you ask ([ADR 0002](../adr/0002-secrets-from-the-environment.md)). Bitwarden Secrets Manager can put your secrets into the environment for a single command, so they never sit on disk.

1. In Bitwarden Secrets Manager, create a **project** for your app and add secrets named exactly like the environment variables your app reads (e.g. `DB_PASSWORD`, `AUTH0_AUDIENCE`).
2. Create a **machine account** with read access to that project and copy its access token.
3. Install the [`bws` CLI](https://bitwarden.com/help/secrets-manager-cli/) and export the token once in your shell profile (or your Dev Container forwards it):

   ```bash
   export BWS_ACCESS_TOKEN=…
   ```

4. Run your app with the secrets injected:

   ```bash
   bws run --project-id <project-id> -- pnpm dev
   ```

**In CI**, use the [`bitwarden/sm-action`](https://github.com/bitwarden/sm-action) GitHub Action with the access token stored as a repository secret. **In production**, use your platform's secret injection (e.g. Cloud Run "secrets as environment variables").

Still have a local `.env` file? Load it explicitly: `flux serve --env-file .env` (it must exist) or `--env-file-if-exists .env`.

## Publish a TypeScript package to npm

[Forge](../../projects/forge/README.md) builds each discovered package into a release tree with ESM, CommonJS, and type declarations, copies the package manifest, and publishes that prepared tree to npm.

Today, build and publish are intentionally separate commands:

```bash
pnpm exec forge build --configuration release
pnpm exec forge publish --dry-run

# When the package is ready and npm auth is configured:
pnpm exec forge publish
```

The default [`@decohere/workspace`](../../projects/workspace/README.md) layout discovers packages under `projects/`:

```text
package.json
projects/
  hello/
    package.json
    src/
      index.ts
```

The source package manifest owns its public contract. Point `exports` at Forge's release layout:

```json
{
  "name": "@acme/hello",
  "version": "0.1.0",
  "type": "module",
  "publishConfig": {
    "access": "public"
  },
  "exports": {
    ".": {
      "types": "./types/src/index.d.ts",
      "import": "./es6/src/index.js",
      "require": "./commonjs/src/index.js"
    }
  }
}
```

Forge handles compilation, the ESM/CommonJS/types directory layout, release-tree assembly, private-package skipping, and npm publication. It does not invent the package name, version, or public `exports`.

Build and publish stay separate on purpose: `forge build --configuration release && forge publish` is the intended flow. The remaining gap is generating or validating `exports` (and related entry fields) for Forge's release layout.

## Shut down without dropping requests

Nothing to add: `app.start()` handles SIGTERM and SIGINT. When Kubernetes, Railway, Fly or Ctrl+C asks the process to stop, the app:

1. stops accepting new connections;
2. lets requests already in progress finish, telling those clients to close their connection afterwards;
3. disposes your services (database pools and so on), only once no request needs them;
4. exits with code 0.

If that takes longer than 10 seconds, it prints why and exits with code 1. A second signal exits straight away.

```ts
await app.start({
	port: 3000,
	shutdownTimeoutMs: 25_000, // keep it under your platform's grace period (Kubernetes: 30s)
});

// Handling signals yourself instead:
await app.start({ port: 3000, shutdownSignals: false });
process.on("SIGTERM", () => app.dispose());
```
