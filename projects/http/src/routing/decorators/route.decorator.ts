import { defineMeta } from "@decohere/core/reflection";
import { type HTTPMethod, HTTPMethods, MetadataKeys } from "../../const.js";
import type { RouteMetadata } from "../http.types.js";
import { RouteConfigurationError } from "../http.types.js";

export function Get(path?: string) {
	return routeDecorator(HTTPMethods.GET, path);
}

export function Post(path?: string) {
	return routeDecorator(HTTPMethods.POST, path);
}

export function Put(path?: string) {
	return routeDecorator(HTTPMethods.PUT, path);
}

export function Patch(path?: string) {
	return routeDecorator(HTTPMethods.PATCH, path);
}

export function Delete(path?: string) {
	return routeDecorator(HTTPMethods.DELETE, path);
}

export function Route(method: HTTPMethod, path?: string) {
	return routeDecorator(method, path);
}

/**
 * Store method + relative path only. Controller / global prefixes are applied
 * at registration time in RouteRegistry (avoids TS decorator-order issues).
 */
function routeDecorator(method: HTTPMethod, path: string = "") {
	return (
		targetClass: object,
		functionName: string,
		descriptor?: TypedPropertyDescriptor<(...args: any[]) => any>,
	) => {
		if (path !== "" && !path.startsWith("/")) {
			throw new RouteConfigurationError(
				`Error configuring routes. Path defined in controller ${
					targetClass.constructor.name
				}.${functionName}() should start '/'`,
			);
		}

		const { value: handler } = descriptor;
		const routeConfig: RouteMetadata = { method, path };
		defineMeta(MetadataKeys.route, routeConfig, handler);
	};
}
