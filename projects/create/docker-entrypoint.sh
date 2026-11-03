#!/bin/sh
set -eu

# When running as --user host-uid, ensure HOME exists (npm/auth0 write here).
mkdir -p "${HOME:-/tmp/decohere-create-home}"

run_scaffold() {
	if [ -n "${CREATE_LOCAL_TGZ:-}" ] && [ -f "${CREATE_LOCAL_TGZ}" ]; then
		npm install -g "$CREATE_LOCAL_TGZ"
		decohere "$@"
		return $?
	fi

	if command -v decohere >/dev/null 2>&1; then
		decohere "$@"
		return $?
	fi

	echo "decohere is not installed in this image. Rebuild with create.tgz in the Docker build context." >&2
	exit 1
}

run_scaffold "$@"
scaffold_exit=$?

# Legacy fallback only: when the container still runs as root, chown the tree.
# Prefer docker --user (host uid) so files are never root-owned in the first place.
if [ $scaffold_exit -eq 0 ] && [ -n "${HOST_UID:-}" ] && [ "$(id -u)" -eq 0 ]; then
	if ! chown -R "${HOST_UID}:${HOST_GID:-$HOST_UID}" /workspace; then
		echo "warning: failed to chown /workspace to ${HOST_UID}:${HOST_GID:-$HOST_UID}" >&2
		echo "         run: sudo chown -R \"\$USER:\$USER\" <project-dir>" >&2
	fi
fi

exit $scaffold_exit
