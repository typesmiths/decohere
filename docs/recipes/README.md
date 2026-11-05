# Recipes

Small, outcome-first uses of Decohere. Each uses only the part of the toolchain it needs.

## Run a TypeScript script

Run a `.ts` file directly, with no build step or scaffold.

```bash
mkdir hello && cd hello
npm init -y && npm pkg set type=module
npm i -D @decohere/cli
```

```ts
// hello.ts
const name = process.argv[2] ?? "world";
console.log(`hello ${name}`);
```

```bash
npx flux run hello.ts -- Ada
# hello Ada
```

[Flux](../../projects/flux/README.md) compiles the file with SWC as it loads and forwards everything after `--` to it as `process.argv`.

## Keep secrets out of files (Bitwarden)

Inject secrets into the environment for one command, so they never sit on disk.

Decohere reads settings from environment variables, never from a `.env` file unless you ask ([ADR 0002](../adr/0002-secrets-from-the-environment.md)).

1. In Bitwarden Secrets Manager, create a project and add secrets named like the environment variables your app reads (`DB_PASSWORD`, `AUTH0_AUDIENCE`).
2. Create a machine account with read access to that project and copy its access token.
3. Install the [`bws` CLI](https://bitwarden.com/help/secrets-manager-cli/) and export the token in your shell profile:

   ```bash
   export BWS_ACCESS_TOKEN=…
   ```

4. Run the app with the secrets injected:

   ```bash
   bws run --project-id <project-id> -- pnpm dev
   ```

In CI, use [`bitwarden/sm-action`](https://github.com/bitwarden/sm-action); in production, your platform's secret injection. To load a local `.env` anyway, say so: `flux serve --env-file .env` (must exist) or `--env-file-if-exists .env`.

## Publish a TypeScript package to npm

Build a package into ESM, CommonJS and type declarations, then publish that build.

The default [workspace](../../projects/workspace/README.md) layout finds packages under `projects/`:

```text
package.json
projects/
  hello/
    package.json
    src/index.ts
```

Point the package's `exports` at the layout [Forge](../../projects/forge/README.md) emits:

```json
{
  "name": "@acme/hello",
  "version": "0.1.0",
  "type": "module",
  "publishConfig": { "access": "public" },
  "exports": {
    ".": {
      "types": "./types/src/index.d.ts",
      "import": "./es6/src/index.js",
      "require": "./commonjs/src/index.js"
    }
  }
}
```

```bash
npx forge build --configuration release
npx forge publish --channel latest --dry-run
npx forge publish --channel latest    # after npm login
```

`--channel` is the npm dist-tag and defaults to `beta`. Forge skips private packages and versions already on npm; it does not write the name, version or `exports` for you.

## Shut down without dropping requests

Stop cleanly on SIGTERM or SIGINT; `app.start()` does it by default.

On a signal the app stops accepting connections, lets requests in progress finish, disposes your services, and exits with code 0. If that takes more than 10 seconds it logs an error and exits with code 1; a second signal exits at once.

```ts
await app.start({
	port: 3000,
	shutdownTimeoutMs: 25_000, // keep it under your platform's grace period (Kubernetes: 30s)
});

// Handling signals yourself instead:
await app.start({ port: 3000, shutdownSignals: false });
process.on("SIGTERM", () => app.dispose());
```
