import type { MappedRoute } from "../routing/http.types.js";
import type { RouteRegistry } from "../routing/services/route-registry.js";
import type { OpenApiDocument, OpenApiOperation, OpenApiOptions } from "./openapi.types.js";
import { buildRouteRequestSchemas } from "./request-schema.js";

const DEFAULT_SPEC_PATH = "/openapi.json";

export function resolveOpenApiPath(options: OpenApiOptions): string {
	const path = options.path?.trim() || DEFAULT_SPEC_PATH;
	return path.startsWith("/") ? path : `/${path}`;
}

/** Convert Fastify-style `:id` path params to OpenAPI `{id}`. */
export function toOpenApiPath(fastifyPath: string): string {
	return fastifyPath.replace(/:([A-Za-z_][\w]*)/g, "{$1}");
}

export function generateOpenApiDocument(
	registry: RouteRegistry,
	options: OpenApiOptions,
): OpenApiDocument {
	const paths: OpenApiDocument["paths"] = {};

	for (const route of registry.routes) {
		const path = toOpenApiPath(route.path);
		const method = route.method.toLowerCase();
		let pathItem = paths[path];
		if (pathItem == null) {
			pathItem = {};
			paths[path] = pathItem;
		}
		pathItem[method] = buildOperation(route);
	}

	const document: OpenApiDocument = {
		openapi: "3.0.3",
		info: options.info,
		paths,
	};
	if (options.servers?.length) {
		document.servers = options.servers;
	}
	return document;
}

function buildOperation(route: MappedRoute): OpenApiOperation {
	const { queryParams, pathParams, body: bodySchema } = buildRouteRequestSchemas(route);
	const parameters = [...queryParams, ...pathParams];

	const status = String(route.httpCode ?? 200);
	const operation: OpenApiOperation = {
		operationId: `${route.controller.name}.${route.handler}`,
		tags: [route.controller.name],
		responses: {
			[status]: route.sse
				? {
						description: "Server-sent event stream",
						content: { "text/event-stream": { schema: { type: "string" } } },
					}
				: { description: "Successful response" },
		},
	};
	if (route.routeArgs?.some((arg) => arg.argumentLocation === "lastEventId")) {
		parameters.push({ name: "Last-Event-ID", in: "header", schema: { type: "string" } });
	}
	if (parameters.length > 0) {
		operation.parameters = parameters;
	}
	if (bodySchema != null) {
		operation.requestBody = {
			required: true,
			content: {
				"application/json": { schema: bodySchema },
			},
		};
	}
	return operation;
}
