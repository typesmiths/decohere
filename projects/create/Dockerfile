# syntax=docker/dockerfile:1
# Builder image for `@decohere/create` scaffolding.
#
# create.tgz is the installed @decohere/scaffold tree (including node_modules).
# Unpack it in place — do not `npm install` — so `docker build` needs no npm auth.
#
# Pack the built package into the build context first (same tree e2e tags as `:local`):
#   node projects/create/pack-builder-tgz.mjs \
#     --out-dir dist/release/projects/scaffold \
#     --workspace-out dist/release \
#     --dest projects/create/create.tgz
#   docker build -f Dockerfile \
#     --build-arg CREATE_VERSION=0.0.1-dev.44 \
#     -t ghcr.io/typesmiths/decohere/create:0.0.1-dev.44 .

FROM node:24-slim

ARG CREATE_VERSION
ENV CREATE_VERSION=$CREATE_VERSION
RUN test -n "$CREATE_VERSION" || (echo "ERROR: --build-arg CREATE_VERSION is required" && exit 1)

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install auth0 CLI into /usr/local/bin so it is available on PATH.
# Keep this version the same as the Dev Container's (a test checks).
RUN curl -sSfL https://raw.githubusercontent.com/auth0/auth0-cli/v1.39.0/install.sh \
    | sh -s -- -b /usr/local/bin v1.39.0

# Install Biome globally so scaffolded files can be linted before handoff.
RUN npm install -g @biomejs/biome

COPY create.tgz /tmp/create.tgz
RUN mkdir -p /usr/local/lib/node_modules/@decohere/scaffold \
    && tar -xzf /tmp/create.tgz -C /usr/local/lib/node_modules/@decohere/scaffold \
    && ln -sf /usr/local/lib/node_modules/@decohere/scaffold/es6/src/cli.js /usr/local/bin/decohere \
    && chmod +x /usr/local/lib/node_modules/@decohere/scaffold/es6/src/cli.js \
    && rm -f /tmp/create.tgz

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# The scaffolder writes only here, and the launcher copies the result out.
RUN mkdir -p /workspace && chown node:node /workspace
WORKDIR /workspace
USER node

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
