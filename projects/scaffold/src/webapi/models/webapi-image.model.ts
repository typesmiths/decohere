import { DockerfileModel } from "../../models/docker-image.model.js";
import { CREATE_VERSION, DEVCONTAINER_IMAGE_REPOSITORY } from "../../version.js";

/**
 * Scaffolded app `.devcontainer/Dockerfile` — thin `FROM` the published base image.
 * Optional feature layers (e.g. postgresql-client) append via `addLayer`.
 */
export class WebapiDevContainer extends DockerfileModel {
	public constructor(baseImage = `${DEVCONTAINER_IMAGE_REPOSITORY}:${CREATE_VERSION}`) {
		super(baseImage);
	}

	public files() {
		return [
			{
				filePath: ".devcontainer/Dockerfile",
				content: this.build(),
			},
		];
	}
}
