# 0007. A module serves its built UI from its API: `statics`, outside the pipeline, cached by file kind

- **Status:** Proposed
- **Date:** 2026-10-12 · updated 2026-10-14

## Context

A module deploys as one image that runs its API and serves its UI's build. The two ship as a matching pair, and the UI calls the API on its own origin (no CORS, no second service). The HTTP package could not serve files. Fastify details stay in the provider ([architecture](../architecture/README.md#2-vendors-stay-at-the-composition-edge)). How the UI is built (`vite build`) is not decided here.

## Decision

- **API.** The `statics` setting of `http(...)`, e.g. `statics: [{ prefix: "/ui/", directory: "ui" }]`. The prefix is normalised to `/ui/`; `/` mounts at the root; an empty prefix or the same prefix twice is refused; the call can repeat for several UIs. The directory resolves from the working directory at start, like `./config`. The global prefix does not apply. Options (`StaticOptions`), caching rules and the missing-directory policy are provider-neutral (`src/http/http.static.ts`); only registering `@fastify/static` is in `FastifyProvider`.
- **Outside the pipeline.** Static files are Fastify routes beside the HTTP routes, not in the route registry. `@Authorize`, token checks, validation and middleware never apply: a UI shell is public. Middleware such as the access log does not see them, and they are not in OpenAPI. Helmet and CORS (Fastify plugins) still apply.
- **Exempt from the rate limit.** One page load fetches dozens of files, so the API default (100 a minute) would answer 429 to ordinary use, and a file read is not the work the limit protects. The exemption is an `allowList` entry matching the route the request resolved to (`/ui/*`), not the URL text, so a crafted path cannot reach it; a caller's own `allowList` still works. A separate generous limit was rejected as another number to tune that protects nothing. Bandwidth abuse is for the CDN or proxy.
- **Caching by kind of file.** Entry points (`noCache`, default `index.html` and `remoteEntry.js`, which name or load the hashed bundles) get `no-cache`. A name carrying a content hash gets `public, max-age=31536000, immutable`. Anything else gets `public, max-age=0, must-revalidate` with `ETag`, so the browser revalidates and gets a 304. The hash pattern is narrow on purpose: a file wrongly marked immutable is stuck in browsers for a year, one wrongly revalidated costs a 304. All three rules can be replaced (`noCache`, `immutable`, `cacheControl`); the [README](../../projects/http/README.md) has the details.
- **SPA fallback** (default on, `spaFallback: false` to opt out). An unknown path under the prefix serves `index.html` only for a browser navigation: GET or HEAD, no file extension or dotfile in the path (a missing asset is a real 404), an `Accept` that includes `text/html` (not `q=0`), and not under the app's own API. Anything else gets the HTTP package's normal JSON 404, unchanged. It is the not-found handler of a Fastify context at the prefix; at `/` that is the app's own not-found handler, which is why it hands back everything it does not take. `/ui` redirects (301) to `/ui/`.
- **Root mount.** `{ prefix: "/", directory: "ui" }` needs no config. Fastify matches specific routes before the static wildcard, so API routes, `/health` and OpenAPI are never shadowed. What decides an unknown path is the `Accept` rule (an API client mistyping `/lp/portfolo` gets the JSON 404, not HTML with a 200) and "under the API":
  - with a global prefix, the API is that prefix plus the OpenAPI path; every other path is free for the UI;
  - without one, nothing says where the API lives, so a path whose first segment matches the first segment of any HTTP route is never answered with the app. First segment, not exact match, because a mistyped `/lp/portfolio/...` must stay an API 404. The cost: a client route sharing a first segment with an API route (`/portfolio` next to `/portfolio/items`) needs another path, or the app sets a global prefix;
  - either way, routes of a controller declared `globalPrefix: false` (the health probes) count as API: their literal start (up to the first parameter) and everything below. Parameter segments (`/:id`) are ignored.

  `exclude` globs list further paths the mount never answers. A routing table or middleware were rejected: static stays outside the pipeline. With two mounts, the more specific prefix wins.
- **Security.** Traversal protection, ignored dotfiles and no directory listing come from `@fastify/static`, and are tested with raw requests (`..`, encoded, double-encoded, backslash, NUL), not assumed.
- **Missing directory.** `onMissingDirectory: "fail"` stops the app at start, naming the path; `"warn"` logs and serves nothing, so the API boots before the UI is built. The default is `"warn"` when `NODE_ENV` is `development` or `dev` (as for auth's `devStatic`), else `"fail"`, so a production image without its UI does not pass as healthy.
- **`forge package`.** A deployable declares its UI in `.decohere.js` beside `docker`: `ui = { project: "@app/shop.web", output?: "dist", to?: "ui" }`. Packaging copies `<ui project>/<output>` to `.package/<to>/` and fails with "Build the UI first" when it is missing; it does not build the UI. `forge build` does: a UI project has its own `build` script, and forge runs it instead of compiling the project, so `forge build && forge package` is the whole release. The Dockerfile is unchanged, and `statics("/ui/", "ui")` finds the folder because the container runs in `.package/`.
- **Dependency.** `@fastify/static` (MIT, Fastify team) rather than a hand-written file server, for path safety, ranges, conditional requests and content types.

## Consequences

- The UI shell and assets are public. Anything private comes from the API, behind `@Authorize`.
- Static requests are not access-logged by the HTTP package; a proxy or CDN logs them.
- Files are looked up on each request (`wildcard: true`), so a rebuilt UI is served without a restart; a directory missing at start needs a restart.
- Files are compressed on the fly ([ADR 0008](0008-response-compression-in-http.md)). Pre-compressed files, a UI-specific Content-Security-Policy and a per-mount rate limit are not done.
- `forge package` needs the UI built first, by `forge build` running the UI's own `build` script.
- One UI per deployable can be declared for packaging (`ui` is one object), though `statics` can serve several.
- A controller route under a non-root mount's prefix is shadowed or conflicts; keep the prefix for the UI.
- The app is served only to requests that accept HTML. A client with no `Accept` header (bare `curl`) gets the JSON 404 for client routes; `GET /` and files do not depend on it.

## History

- 2026-10-12: Decided.
- 2026-10-12: A root mount is allowed; the fallback decides by `Accept`, by registered routes and by `exclude`.
- 2026-10-12: With a global prefix, the fallback's API boundary is the prefix and the OpenAPI path; without one, the first-segment rule.
- 2026-10-14: The global prefix's own `exclude` list is gone: it had to be kept in step with the controllers. A controller opts out instead (`@Controller({ globalPrefix: false })`); the health controller does, `health({ underGlobalPrefix: true })` puts it back, and routes outside the prefix count as the API for the fallback.
- 2026-11-09: `forge build` runs a UI project's own `build` script, so the UI no longer has to be built by hand before `forge package`.
- 2026-11-06: `withStatic` became the `statics` setting of `http(...)`, when the builder's extensions became plugins ([ADR 0014](0014-package-names.md)).
