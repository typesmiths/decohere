import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { KeyedModel, SourceFile } from "../../models/source-file.js";
import { DEFAULT_WEBAPI_NAME, webapiPackagedEntry, webapiProjectDir } from "../const.js";

/**
 * Production Dockerfile for each API, in the API's own folder: `projects/<name>/Dockerfile`.
 * That is where `forge docker` and `forge package` look for a deployable, and the folder is
 * the Docker build context.
 *
 * The image copies `.package/`, which `forge package` writes before Docker runs: the API's
 * compiled code, the workspace libraries it imports, and a real (symlink-free) `node_modules`
 * of the third-party packages it reaches. So the image build installs nothing, runs no
 * workspace tooling, and needs no npm token.
 */
export class WebapiProductionDockerfile implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.PRODUCTION_DOCKERFILE;

	public constructor(private readonly apiNames: readonly string[] = [DEFAULT_WEBAPI_NAME]) {}

	public files(): SourceFile[] {
		const names = this.apiNames.length > 0 ? this.apiNames : [DEFAULT_WEBAPI_NAME];
		return names.flatMap((name) => [
			{
				filePath: `${webapiProjectDir(name)}/Dockerfile`,
				content: renderProductionDockerfile(name),
			},
			{
				filePath: `${webapiProjectDir(name)}/.dockerignore`,
				content: dockerignoreContent(),
			},
		]);
	}
}

export function renderProductionDockerfile(apiName: string): string {
	const projectDir = webapiProjectDir(apiName);
	const entry = webapiPackagedEntry();

	return `# syntax=docker/dockerfile:1
# Production image for ${apiName}. Docker only copies the packaged app; it installs nothing.
#
# Build the package first (release build, then .package/ in each API), then the image:
#   pnpm run package:${apiName}
#   docker build -t ${apiName} ${projectDir}
# or, with the image name and tags from the workspace:
#   pnpm run package:${apiName} && pnpm exec forge docker --configuration release
#
# Hosts that build from a git clone (Railway, Fly) do not have .package/. Build and push the
# image from CI instead, or run the package step before \`docker build\`.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV CONFIG_APP=${apiName}

COPY .package/ ./

EXPOSE 3000
CMD ["node", "${entry}"]
`;
}

/** The build context is the project folder; only the package belongs in the image. */
function dockerignoreContent(): string {
	return ["*", "!.package", ""].join("\n");
}
