import { type BootModuleOptions, bootModule as bootOn } from "@decohere/http/testing";
import { FastifyProvider } from "../../src/index.js";

/** `bootModule` from `@decohere/http/testing`, always on this package's provider. */
export function bootModule(options: Omit<BootModuleOptions, "provider">) {
	return bootOn({ ...options, provider: FastifyProvider });
}
