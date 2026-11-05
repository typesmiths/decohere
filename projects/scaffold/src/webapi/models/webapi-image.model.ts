import { DockerfileModel, DockerStep, withNodeUser } from "../../models/docker-image.model.js";
import { CREATE_VERSION, DEVCONTAINER_IMAGE_REPOSITORY } from "../../version.js";

/**
 * Scaffolded app `.devcontainer/Dockerfile` — thin `FROM` the published base image.
 * Optional feature layers (e.g. postgresql-client) append via `addLayer`.
 */
export class WebapiDevContainer extends DockerfileModel {
	public constructor(baseImage = `${DEVCONTAINER_IMAGE_REPOSITORY}:${CREATE_VERSION}`) {
		super(baseImage);
	}

	/**
	 * The base image ends as the node user, and its build arguments don't carry over. So this image
	 * declares its own, runs its layers as root, and hands back to that user at the end.
	 */
	protected override registerBaseLayers(): void {
		super.registerBaseLayers();
		this.addLayer(withNodeUser({ order: 1 })).addStep(
			DockerStep.raw("become-root", "USER root", 2),
		);
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
