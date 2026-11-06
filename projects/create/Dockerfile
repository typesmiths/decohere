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

# Tools used only while building stay in this stage, so curl never reaches the image.
FROM node:24-alpine AS auth0-cli
RUN apk add --no-cache curl
# Keep this version the same as the Dev Container's (a test checks).
RUN curl -sSfL https://raw.githubusercontent.com/auth0/auth0-cli/v1.39.0/install.sh \
    | sh -s -- -b /usr/local/bin v1.39.0

# Bare minimum: plain Alpine, with only the Node binary and what it links against, the scaffolder
# and the Auth0 CLI. It never installs anything, so it has no npm. Formatting happens in the
# project, which installs Prettier itself. Copying Node is what keeps npm out: deleting it in a later
# layer wouldn't make the image smaller.
FROM alpine:3.24

ARG CREATE_VERSION
ENV CREATE_VERSION=$CREATE_VERSION
RUN test -n "$CREATE_VERSION" || (echo "ERROR: --build-arg CREATE_VERSION is required" && exit 1)

RUN apk add --no-cache libstdc++ libgcc && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node

COPY --from=auth0-cli /usr/local/bin/node /usr/local/bin/node
COPY --from=auth0-cli /usr/local/bin/auth0 /usr/local/bin/auth0

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
