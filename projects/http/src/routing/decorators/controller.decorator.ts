import type { Constructable } from "@decohere/core/reflection";
import { MetadataKeys } from "../../const.js";
import type { ControllerMetadata } from "../http.types.js";

export function Controller(options?: ControllerMetadata) {
	return (target: Constructable) => {
		Reflect.defineMetadata(MetadataKeys.controller, options, target.prototype);
	};
}
