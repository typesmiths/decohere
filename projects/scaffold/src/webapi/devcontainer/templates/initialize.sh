#!/usr/bin/env bash
# Runs on the host before the container is created (devcontainer initializeCommand).
# Creates bind-mount sources as the host user so Docker does not create them as root.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gh_dir="$root/.devcontainer/gh-auth"
gh_env="$root/.devcontainer/gh.env"

if ! mkdir -p "$gh_dir" 2>/dev/null; then
	echo "Cannot create $gh_dir (permission denied)." >&2
	echo "The scaffold container likely left .devcontainer root-owned. Fix with:" >&2
	echo "  sudo chown -R \"$USER:$USER\" \"$root\"" >&2
	exit 1
fi
{
	echo "*"
	echo "!.gitignore"
} >"$gh_dir/.gitignore"

if [[ -d "$gh_env" ]]; then
	echo "Refusing to start: $gh_env is a directory (left by a prior bind mount). Remove it and rebuild." >&2
	exit 1
fi
touch "$gh_env"

# In memory on Linux, so the Auth0 login is never on disk. Keep in step with docker-compose.yml.
project="$(sed -n 's/^name: *//p' "$root/.devcontainer/docker-compose.yml" | head -n 1)"
mkdir -p -m 700 "${XDG_RUNTIME_DIR:-$HOME/.config/decohere}/decohere-auth0/$project"

# Postgres runs as you, so you can delete its files without sudo. Keep in step with docker-compose.yml.
if grep -q 'postgres-data:' "$root/.devcontainer/docker-compose.yml"; then
	mkdir -p "$root/.devcontainer/postgres-data"
	printf 'DECOHERE_UID=%s\nDECOHERE_GID=%s\n' "$(id -u)" "$(id -g)" >"$root/.devcontainer/.env"
fi
