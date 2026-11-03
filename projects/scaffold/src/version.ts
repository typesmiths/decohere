import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _require = createRequire(import.meta.url);

type CreatePackageMetadata = {
	name?: string;
	version?: string;
	decohere?: {
		dockerImageRepository?: string;
		devcontainerImageRepository?: string;
	};
};

const DEFAULT_CREATE_VERSION = "0.0.1-dev";
const DEFAULT_CREATE_IMAGE_REPOSITORY = "ghcr.io/typesmiths/decohere/create";
const DEFAULT_DEVCONTAINER_IMAGE_REPOSITORY = "ghcr.io/typesmiths/decohere/devcontainer";

function resolveCreateMetadata() {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 5; i++) {
		try {
			const pkg = _require(join(dir, "package.json")) as CreatePackageMetadata;
			if (pkg.name === "@decohere/scaffold") {
				return {
					version: pkg.version ?? DEFAULT_CREATE_VERSION,
					imageRepository:
						pkg.decohere?.dockerImageRepository ?? DEFAULT_CREATE_IMAGE_REPOSITORY,
					devcontainerImageRepository:
						pkg.decohere?.devcontainerImageRepository ?? DEFAULT_DEVCONTAINER_IMAGE_REPOSITORY,
				};
			}
		} catch {}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return {
		version: DEFAULT_CREATE_VERSION,
		imageRepository: DEFAULT_CREATE_IMAGE_REPOSITORY,
		devcontainerImageRepository: DEFAULT_DEVCONTAINER_IMAGE_REPOSITORY,
	};
}

const createMetadata = resolveCreateMetadata();

/** Version of @decohere/create, used to pin scaffolded @decohere/* dependencies. */
export const CREATE_VERSION = createMetadata.version;

/** Canonical published Docker repository for the @decohere/create builder image. */
export const CREATE_IMAGE_REPOSITORY = createMetadata.imageRepository;

/** Published app Dev Container base (`docker pull` updates shared layers). */
export const DEVCONTAINER_IMAGE_REPOSITORY = createMetadata.devcontainerImageRepository;
