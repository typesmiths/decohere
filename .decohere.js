import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {{ decohere?: { dockerImageRepository?: string } }} */
const createPackage = require("./projects/create/package.json");
/** @type {{ decohere?: { dockerImageRepository?: string } }} */
const devcontainerPackage = require("./projects/devcontainer/package.json");

const createImageRepository =
	createPackage.decohere?.dockerImageRepository ?? "ghcr.io/typesmiths/decohere/create";
const devcontainerImageRepository =
	devcontainerPackage.decohere?.dockerImageRepository ??
	"ghcr.io/typesmiths/decohere/devcontainer";

/** @type {import("@decohere/workspace").WorkspaceOptions} */
const config = {
	projects: {
		"@decohere/create": {
			docker: {
				image: createImageRepository,
			},
		},
		"@decohere/devcontainer": {
			docker: {
				image: devcontainerImageRepository,
			},
		},
	},
};

export default config;
