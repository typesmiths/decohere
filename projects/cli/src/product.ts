import { FluxModule } from "@decohere/flux";
import { ForgeModule } from "@decohere/forge";
import { RootModule } from "./root.module.js";
import { HostAddModule, HostAuth0Module, HostCreateModule } from "./scaffold-host.js";

const modules = [
	ForgeModule,
	FluxModule,
	HostCreateModule,
	HostAddModule,
	HostAuth0Module,
] as const;

function create(options?: {
	configFile?: string;
	logLevel?: string;
	rootDir?: string;
}): Promise<RootModule> {
	return RootModule.create(modules, options);
}

/** Shipped `decohere` bin — forge, flux, create, add, auth0. */
export const productCli = { create, modules };
