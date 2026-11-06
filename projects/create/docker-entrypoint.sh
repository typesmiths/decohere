#!/bin/sh
set -eu

if ! command -v decohere >/dev/null 2>&1; then
	echo "decohere is not installed in this image. Rebuild with create.tgz in the Docker build context." >&2
	exit 1
fi

exec decohere "$@"
