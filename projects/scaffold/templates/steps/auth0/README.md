## Auth0

JWT auth is wired from `.env` (`AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`).
After you add a controller, `@Authorize("read", "Invoice")` becomes the Auth0 permission `read:Invoice`.
Sync the Auth0 API and admin grants without re-scaffolding:

```bash
pnpm decohere auth0 login      # once / when the CLI token expires
pnpm decohere auth0 configure  # after new @Authorize decorators
```

With Auth0 on, every route needs a token unless it has `@AllowAnonymous()`. Call one with a token, in the Dev Container:

```bash
curl -H "Authorization: Bearer $(pnpm -s decohere auth0 token)" localhost:3000/<route>
```

That token comes from a machine app with every permission on the API, so use it only for development.
