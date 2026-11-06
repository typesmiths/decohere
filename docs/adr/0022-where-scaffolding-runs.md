# 0022. Scaffolding runs where its tools are, with nothing shared from the machine

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Scaffolding needs tools, such as the Auth0 CLI, that shouldn't have to be installed on someone's machine. It ran in a container with folders from the machine shared into it. Docker finds shared folders on the machine running Docker, which isn't always where the command runs, so inside a Dev Container it created empty root-owned folders on the host and the scaffolder failed. Every run also gave that container the Auth0 login and `~/.npmrc`.

## Decision

- **Inside a Decohere Dev Container, every command runs right there.** Its image sets `DECOHERE_TOOLS=1` and has the tools, so no second container starts.
- **Anywhere else, `create` uses the scaffolder image with nothing shared.** It runs as a non-root user in its own folder. The launcher copies the project out with `docker cp`, through a temporary folder, only after a successful run. It removes the container on success, failure and signals.
- **The scaffolder image is the bare minimum:** plain Alpine with the Node binary, the scaffolder and the Auth0 CLI, and no npm, Biome or curl. A new project formats itself on its first install in the Dev Container, because it installs Biome anyway.
- **A new project goes only into an empty folder** (`.git` is allowed), so a copy can't overwrite anyone's files.
- **Commands on an existing project (`add`, `auth0`) run only in its Dev Container.** Anywhere else they stop and say so.
- **The Auth0 CLI login is kept per project, in a folder you can see:** `$XDG_RUNTIME_DIR/decohere-auth0/<project>` on Linux, held in memory, and under `~/.config/decohere` elsewhere. `initialize.sh` creates it first on the host. A project can't act on another's tenant, and `configure` and `add auth0` stop if the active tenant differs from the one in `.env`.

## Consequences

- `create` works the same from a host, from inside a container, and against a remote Docker. It still needs Docker somewhere, or a Decohere Dev Container.
- Choosing Auth0 during `create` means a second login in the Dev Container, once, because the first goes away with the container.
- Projects created before this need the new image before `add` and `auth0` work.
- A private registry configured in `~/.npmrc` no longer reaches the scaffolder. Scaffolding uses public packages only.
- Running `create` again over an existing project is refused.
- The two images each list their tools. A test keeps the Auth0 CLI version the same. Building one from the other would need forge to build images in order, which it doesn't today.

## History

- 2026-11-06: Decided.
- 2026-11-06: The scaffolder image became the bare minimum, and formatting moved to the project's first install.
- 2026-11-06: The Auth0 login moved from a named volume, which was opaque, to a folder per project on the host.
