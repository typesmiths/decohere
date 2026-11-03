import path from "node:path";
import type { Project } from "@decohere/workspace";
import { io } from "@decohere/core/io";

/** Where `forge package` writes a deployable's output: inside the project, the Docker build context. */
export const PACKAGE_DIR = ".package";

/**
 * A deployable is a project with a Dockerfile: `docker.dockerfile` from `.decohere.js`,
 * or `Dockerfile` in the project folder. `forge docker` and `forge package` share this
 * rule so they always agree on which projects are deployables.
 */
function dockerfileName(project: Project): string {
	return project.dockerConfig?.dockerfile ?? "Dockerfile";
}

function dockerfilePath(project: Project): string {
	return path.join(project.projectRoot, dockerfileName(project));
}

async function isDeployable(project: Project): Promise<boolean> {
	return await io.fileExists(dockerfilePath(project));
}

export const deployable = { dockerfileName, dockerfilePath, isDeployable };
