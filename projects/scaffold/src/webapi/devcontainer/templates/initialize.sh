#!/usr/bin/env bash
# Runs on the host before the container is created (devcontainer initializeCommand).
# Creates bind-mount sources as the host user so Docker does not create them as root.
# Keep these paths in step with docker-compose.yml.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="$(sed -n 's/^name: *//p' "$root/.devcontainer/docker-compose.yml" | head -n 1)"

# The GitHub login and any GH_TOKEN, outside the project.
gh_root="$HOME/.config/decohere/gh"
mkdir -p -m 700 "$gh_root/$project"
if [[ -d "$gh_root/$project.env" ]]; then
	echo "Refusing to start: $gh_root/$project.env is a directory (left by a prior bind mount). Remove it and rebuild." >&2
	exit 1
fi
touch "$gh_root/$project.env"
chmod 600 "$gh_root/$project.env"

# In memory on Linux, so the Auth0 login is never on disk.
mkdir -p -m 700 "${XDG_RUNTIME_DIR:-$HOME/.config/decohere}/decohere-auth0/$project"
