import { createRequire, findPackageJSON } from "node:module";
import { dirname } from "node:path";

type ScaffoldPackageMetadata = {
	version: string;
	decohere?: {
		dockerImageRepository?: string;
		devcontainerImageRepository?: string;
	};
};

// The package's own manifest: beside src/ in the repo, and at the package root once published.
// Found and read from the real disk, even in a test that keeps files in memory.
const manifestPath = findPackageJSON(import.meta.url);
if (manifestPath == null) {
	throw new Error(`@decohere/scaffold has no package.json above ${import.meta.url}`);
}
const manifest = createRequire(import.meta.url)(manifestPath) as ScaffoldPackageMetadata;

/** The folder of @decohere/scaffold's package.json, which holds templates/. */
export const PACKAGE_DIR = dirname(manifestPath);

/** Version of @decohere/scaffold (and @decohere/create), used to pin scaffolded @decohere/* dependencies. */
export const CREATE_VERSION = manifest.version;

/** Canonical published Docker repository for the @decohere/create builder image. */
export const CREATE_IMAGE_REPOSITORY =
	manifest.decohere?.dockerImageRepository ?? "ghcr.io/typesmiths/decohere/create";

/** Published app Dev Container base (`docker pull` updates shared layers). */
export const DEVCONTAINER_IMAGE_REPOSITORY =
	manifest.decohere?.devcontainerImageRepository ?? "ghcr.io/typesmiths/decohere/devcontainer";
