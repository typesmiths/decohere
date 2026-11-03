#!/usr/bin/env bash
# Runs on the host before the container is created (devcontainer initializeCommand).
# Creates bind-mount sources as the host user so Docker does not create them as root.
# Optional npm / gh / MCP setup is y/N on a TTY; no TTY skips.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tty-prompt.sh
source "$here/tty-prompt.sh"

npm_dir="$root/.devcontainer/npm-auth"
gh_dir="$root/.devcontainer/gh-auth"
gh_env="$root/.devcontainer/gh.env"
cursor_dir="$root/.cursor"
RAG_ENV="$cursor_dir/codebase-rag.env"

run_codebase_rag_mcp() {
	local script="$here/codebase-rag-mcp.ts"
	CODEBASE_RAG_WORKSPACE="$root" node --experimental-strip-types "$script" "$@"
}

load_rag_env() {
	RAG_URL=""
	RAG_TOKEN=""
	[[ -f "$RAG_ENV" ]] || return 0
	# shellcheck disable=SC1090
	set -a
	# shellcheck disable=SC1090
	source "$RAG_ENV"
	set +a
	RAG_URL="${CODEBASE_RAG_MCP_URL:-}"
	RAG_TOKEN="${CODEBASE_RAG_MCP_TOKEN:-}"
}

write_rag_env() {
	mkdir -p "$(dirname "$RAG_ENV")"
	umask 077
	cat >"$RAG_ENV" <<EOF
# Written by .devcontainer/initialize.sh. Not in git.
CODEBASE_RAG_MCP_URL=${RAG_URL}
CODEBASE_RAG_MCP_TOKEN=${RAG_TOKEN}
CODEBASE_RAG_MCP_ROOT=${root}
EOF
	chmod 600 "$RAG_ENV"
	if [[ -n "$RAG_URL" && -n "$RAG_TOKEN" ]]; then
		run_codebase_rag_mcp merge || true
	fi
}

seed_rag_from_host_mcp() {
	local mcp="${HOME}/.cursor/mcp.json"
	[[ -f "$mcp" ]] || return 1
	command -v node >/dev/null 2>&1 || return 1
	run_codebase_rag_mcp seed-print "$mcp"
}

ensure_cursor_dir() {
	mkdir -p "$cursor_dir"
}

ensure_auth_dir() {
	local dir="$1"
	if ! mkdir -p "$dir" 2>/dev/null; then
		echo "Cannot create $dir (permission denied)." >&2
		echo "The scaffold container likely left .devcontainer root-owned. Fix with:" >&2
		echo "  sudo chown -R \"$USER:$USER\" \"$root\"" >&2
		exit 1
	fi
	{
		echo "*"
		echo "!.gitignore"
	} >"$dir/.gitignore"
}

ensure_gh_env() {
	if [[ -d "$gh_env" ]]; then
		echo "Refusing to start: $gh_env is a directory (left by a prior bind mount). Remove it and rebuild." >&2
		exit 1
	fi
	touch "$gh_env"
}

setup_npm_auth() {
	if [[ -f "$npm_dir/.npmrc" ]]; then
		echo "npm auth: using $npm_dir/.npmrc"
		return 0
	fi
	if ! prompt_yn "Configure npm auth for this workspace?"; then
		echo "npm auth: skipped"
		return 0
	fi
	if [[ -f "${HOME}/.npmrc" ]]; then
		cp -a "${HOME}/.npmrc" "$npm_dir/.npmrc"
		echo "npm auth: copied ~/.npmrc → $npm_dir/.npmrc"
		return 0
	fi
	echo "npm auth: no ~/.npmrc — log in inside the container if prompted"
}

setup_gh_auth() {
	if [[ -f "$gh_dir/hosts.yml" ]]; then
		echo "gh auth: using $gh_dir/hosts.yml"
		return 0
	fi
	if ! prompt_yn "Configure GitHub CLI auth for this workspace?"; then
		echo "gh auth: skipped"
		return 0
	fi
	if [[ -f "${HOME}/.config/gh/hosts.yml" ]]; then
		cp -a "${HOME}/.config/gh/hosts.yml" "$gh_dir/hosts.yml"
		[[ -f "${HOME}/.config/gh/config.yml" ]] &&
			cp -a "${HOME}/.config/gh/config.yml" "$gh_dir/config.yml"
		echo "gh auth: copied ~/.config/gh → $gh_dir"
		return 0
	fi
	echo "gh auth: no ~/.config/gh/hosts.yml — log in inside the container if prompted"
}

setup_codebase_rag_env() {
	load_rag_env
	if [[ -n "$RAG_URL" && -n "$RAG_TOKEN" ]]; then
		write_rag_env
		echo "codebase-rag MCP: using $RAG_ENV"
		return 0
	fi

	local seeded
	if seeded="$(seed_rag_from_host_mcp 2>/dev/null)"; then
		if prompt_yn "Found codebase-rag in ~/.cursor/mcp.json. Use it for this workspace?" y; then
			RAG_URL="$(printf '%s\n' "$seeded" | sed -n '1p')"
			RAG_TOKEN="$(printf '%s\n' "$seeded" | sed -n '2p')"
			write_rag_env
			echo "codebase-rag MCP: imported HTTP server from ~/.cursor/mcp.json → $RAG_ENV"
			return 0
		fi
	fi

	if ! prompt_yn "Configure codebase RAG MCP (semantic search)?"; then
		RAG_URL=""
		RAG_TOKEN=""
		write_rag_env
		echo "codebase-rag MCP: skipped"
		return 0
	fi

	printf '%s\n' "Empty URL skips. Example: https://rag.example.com/mcp" >/dev/tty
	printf '%s' "MCP URL: " >/dev/tty
	read_tty RAG_URL
	RAG_URL="$(printf '%s' "$RAG_URL" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
	if [[ -z "$RAG_URL" ]]; then
		RAG_TOKEN=""
		write_rag_env
		echo "codebase-rag MCP: skipped"
		return 0
	fi
	printf '%s' "Bearer token (hidden): " >/dev/tty
	read_tty RAG_TOKEN hidden
	write_rag_env
	echo "codebase-rag MCP: saved $RAG_ENV"
}

ensure_auth_dir "$npm_dir"
ensure_auth_dir "$gh_dir"
ensure_gh_env
ensure_cursor_dir
setup_npm_auth
setup_gh_auth
setup_codebase_rag_env
