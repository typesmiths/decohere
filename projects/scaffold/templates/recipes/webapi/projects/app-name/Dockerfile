# syntax=docker/dockerfile:1
# Production image for app-name. Docker only copies the packaged app; it installs nothing.
#
# Build the package first (release build, then .package/ in each app), then the image:
#   pnpm run package:app-name
#   docker build -t app-name projects/app-name
# or, with the image name and tags from the workspace:
#   pnpm run package:app-name && pnpm exec forge docker --configuration release
#
# Hosts that build from a git clone (Railway, Fly) do not have .package/. Build and push the
# image from CI instead, or run the package step before `docker build`.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY .package/ ./

EXPOSE 3000
CMD ["node", "es6/src/main.js"]
