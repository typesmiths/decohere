#!/usr/bin/env bash
# Runs on every container start, so it does only what a start undoes. Remote Control is for this
# repo's own container: the image new projects get doesn't have it.
set -euo pipefail

# Claude Code's settings file lives in the mounted ~/.claude (CLAUDE_CONFIG_DIR, devcontainer.json),
# so trust and Remote Control survive a rebuild. The first start with it takes home's copy in.
claude_config="$HOME/.claude/.claude.json"
if [ ! -e "$claude_config" ] && [ -f "$HOME/.claude.json" ]; then
	cp -p "$HOME/.claude.json" "$claude_config"
	chmod 600 "$claude_config"
fi

# `claude` on the PATH: the VS Code extension brings Claude Code but keeps the binary under a
# versioned folder. The newest is picked at each run, so an extension update needs no restart.
mkdir -p "$HOME/.local/bin"
cat >"$HOME/.local/bin/claude" <<'SH'
#!/bin/sh
bin=$(ls -d "$HOME"/.vscode-server/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -n 1)
[ -n "$bin" ] || { echo "claude: the VS Code extension isn't installed in this container yet" >&2; exit 127; }
exec "$bin" "$@"
SH
chmod 755 "$HOME/.local/bin/claude"

# Remote Control starts with the container, so it can be reached from the phone as soon as it's up.
# One at a time (a lock), restarted if it exits, and it waits for the launcher's binary, which the
# VS Code extension brings on a fresh container. Its output goes to the log below.
rc_log="$HOME/.cache/claude-remote-control.log"
mkdir -p "$HOME/.cache"
setsid -f bash -c '
	exec 9>"$HOME/.cache/claude-remote-control.lock"
	flock -n 9 || exit 0
	cd /src
	while :; do
		if "$HOME/.local/bin/claude" --version >/dev/null 2>&1; then
			"$HOME/.local/bin/claude" remote-control --name decohere-container
			echo "remote-control exited ($?) at $(date -u +%FT%TZ); again in 10 s"
		fi
		sleep 10
	done
' >>"$rc_log" 2>&1 </dev/null
