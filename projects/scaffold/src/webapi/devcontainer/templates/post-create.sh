#!/usr/bin/env bash
# Runs after container create and when workspace content updates
# (devcontainer postCreateCommand / updateContentCommand).
# Installs deps when missing or when the lockfile changed; skips otherwise.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

lockfile="pnpm-lock.yaml"
stamp="node_modules/.decohere-pnpm-lock.sha"

current_hash=""
if [[ -f "$lockfile" ]]; then
	current_hash="$(sha256sum "$lockfile" | awk '{print $1}')"
elif [[ -f package.json ]]; then
	current_hash="$(sha256sum package.json | awk '{print $1}')"
fi

if [[ -d node_modules/.bin ]] && [[ -n "$current_hash" ]] && [[ -f "$stamp" ]] && [[ "$(cat "$stamp")" == "$current_hash" ]]; then
	echo "node_modules: up to date, skipping pnpm install"
	exit 0
fi

echo "node_modules: installing dependencies (first create may take a while)..."
if [[ -f "$lockfile" ]]; then
	pnpm install --frozen-lockfile
else
	pnpm install
fi

if [[ -n "$current_hash" ]]; then
	mkdir -p node_modules
	printf '%s\n' "$current_hash" >"$stamp"
fi
