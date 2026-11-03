#!/usr/bin/env bash
# Runs on every container start (devcontainer postStartCommand).
# Optional npm / gh login is y/N on a TTY. Install is post-create.sh.
# MCP merge also runs here for later reconnects; the Compose service command
# merges before Cursor attaches (postStart is too late for the first snapshot).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
# shellcheck source=tty-prompt.sh
source "$here/tty-prompt.sh"

CODEBASE_RAG_WORKSPACE="$root" node --experimental-strip-types "$here/codebase-rag-mcp.ts" merge ||
	echo "codebase-rag MCP: merge skipped" >&2

AUTH_REGISTRY="https://registry.npmjs.org"

ensure_npm_auth() {
	if npm whoami --registry "$AUTH_REGISTRY" >/dev/null 2>&1; then
		echo "npm: logged in as $(npm whoami --registry "$AUTH_REGISTRY")"
		return 0
	fi

	if prompt_yn "Log in to npm?"; then
		echo "npm: starting login..."
		npm login --registry "$AUTH_REGISTRY" </dev/tty >/dev/tty
		return 0
	fi

	echo "npm: skipped. Open a terminal and run: npm login" >&2
	echo "    (creds persist in .devcontainer/npm-auth/)" >&2
	return 1
}

ensure_gh_auth() {
	if ! command -v gh >/dev/null 2>&1; then
		echo "gh: not installed in this container" >&2
		return 1
	fi

	if gh auth status >/dev/null 2>&1; then
		echo "gh: $(gh auth status 2>&1 | head -n1)"
		return 0
	fi

	local token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
	if [[ -n "$token" ]]; then
		echo "gh: authenticating from GH_TOKEN..."
		printf '%s\n' "$token" | gh auth login --with-token
		return 0
	fi

	if prompt_yn "Log in to GitHub CLI (gh)?"; then
		echo "gh: starting login..."
		gh auth login </dev/tty >/dev/tty
		return 0
	fi

	echo "gh: skipped. Open a terminal and run: gh auth login" >&2
	echo "    (creds persist in .devcontainer/gh-auth/; or set GH_TOKEN in .devcontainer/gh.env)" >&2
	return 1
}

ensure_npm_auth || true
ensure_gh_auth || true
