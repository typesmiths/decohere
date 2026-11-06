# syntax=docker/dockerfile:1
# App Dev Container base for Decohere-scaffolded projects.
# Regenerated from AppDevContainerBaseImage — do not hand-edit layers:
#   pnpm test:file projects/scaffold/tests/devcontainer-base-image.spec.ts
#   (fails when out of sync; update this file from the expected content in the test error)
#
# Publish: forge docker (image name from the repository in the root package.json). Scaffolded apps:
#   FROM ghcr.io/typesmiths/decohere/devcontainer:<version>
#

FROM node:24-trixie-slim

RUN mkdir -p /commandhistory && touch /commandhistory/.bash_history && chown -R node /commandhistory

ENV HISTFILE=/commandhistory/.bash_history

RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
	&& echo "$SNIPPET" >> "/home/node/.bashrc"

ARG USERNAME=node

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git less openssh-client procps && rm -rf /var/lib/apt/lists/*

RUN npm install --global npm@latest && npm add --global pnpm@10

RUN mkdir -p /home/${USERNAME}/.config/pnpm /home/${USERNAME}/.pnpm-store && chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.config /home/${USERNAME}/.pnpm-store && printf "store-dir=/home/${USERNAME}/.pnpm-store\n" > /home/${USERNAME}/.config/pnpm/rc

RUN apt-get update && apt-get install -y --no-install-recommends gh && rm -rf /var/lib/apt/lists/*

RUN curl -sSfL https://raw.githubusercontent.com/auth0/auth0-cli/v1.39.0/install.sh | sh -s -- -b /usr/local/bin v1.39.0

RUN mkdir -p /home/${USERNAME}/.config/auth0 && chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.config/auth0

ENV DECOHERE_TOOLS=1

RUN mkdir -p /workspace/node_modules && chown ${USERNAME}:${USERNAME} /workspace/node_modules

# VS Code / Cursor js-debug Auto Attach injects --require …/bootloader.js into
# NODE_OPTIONS. On a fresh Dev Container that path often does not exist yet
# (workspaceStorage file is only created after toggling Auto Attach), which crashes
# every Node command. If the injected path is missing, prefer the stable
# bootloader from the server extension install; otherwise strip the bad require.
RUN cat <<'EOF' >> "/home/${USERNAME}/.bashrc"
if [[ -n "${NODE_OPTIONS:-}" && "${NODE_OPTIONS}" == *"bootloader.js"* ]]; then
    _bootloader_path="$(printf '%s\n' "$NODE_OPTIONS" | sed -n 's/.*--require[= ]\([^[:space:]]*bootloader\.js\).*/\1/p')"
    if [[ -n "${_bootloader_path}" && ! -f "${_bootloader_path}" ]]; then
        _stable_bootloader="$(find /vscode/vscode-server /home/node/.vscode-server/extensions -name "bootloader.js" -path "*/ms-vscode.js-debug/*" 2>/dev/null | head -1)"
        if [[ -n "${_stable_bootloader}" ]]; then
            NODE_OPTIONS="${NODE_OPTIONS//${_bootloader_path}/${_stable_bootloader}}"
        else
            NODE_OPTIONS="$(printf '%s\n' "$NODE_OPTIONS" | sed -E 's#(^| )--require(=| )[[:graph:]]*bootloader\.js( |$)# #g; s#  +# #g; s#^ ##; s# $##')"
            unset VSCODE_INSPECTOR_OPTIONS
        fi
        export NODE_OPTIONS
        if [[ -z "$NODE_OPTIONS" ]]; then
            unset NODE_OPTIONS
        fi
    fi
    unset _bootloader_path _stable_bootloader
fi
EOF

USER ${USERNAME}
