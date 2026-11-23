# @decohere/devcontainer

The base image for the Dev Container of every app Decohere scaffolds. It is an image only: the package is private, has no code and is never published to npm.

- **What is in it.** Node 24 on Debian trixie, pnpm 10, git, the GitHub CLI and the Auth0 CLI, a shell history that survives rebuilds, and `DECOHERE_TOOLS=1`, which tells `decohere` it runs where the scaffolding tools are. It runs as `node`.
- **Where it is published.** `ghcr.io/typesmiths/decohere/devcontainer` (`decohere.dockerImageRepository` in `package.json`). `forge docker` builds it, and the publish workflow (`.github/workflows/publish.yml`) pushes it with the release, beside the `create` image, tagged with the release version (and `latest` on the latest channel).
- **Apps pin it.** A scaffolded app's `.devcontainer/Dockerfile` starts `FROM ghcr.io/typesmiths/decohere/devcontainer:<version>`, the version of the scaffolder that made it (`WebapiDevContainer` in [`@decohere/scaffold`](../scaffold/README.md)).
- **Don't edit the Dockerfile by hand.** It is generated from `AppDevContainerBaseImage` in `projects/scaffold/src/models/docker-image.model.ts`. `projects/scaffold/tests/devcontainer-base-image.spec.ts` fails when the two differ, and its error holds the expected content.

CI's `package` job builds the image on pull requests that change it, and builds a freshly scaffolded app's Dev Container on top of it to check the user, the tools and `DECOHERE_TOOLS`.
