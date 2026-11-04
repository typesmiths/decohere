import { isPrimitiveOrDateType } from "@decohere/core/reflection";
import { InjectedParts, type MappedRoute, type RouteArg } from "../routing/http.types.js";
import type { JsonSchema, OpenApiParameter } from "./openapi.types.js";

/**
 * Request shapes derived from route / `@Field` metadata (same source as OpenAPI).
 * Used by the document generator and the AJV request validator.
 */
export type RouteRequestSchemas = {
	queryParams: OpenApiParameter[];
	pathParams: OpenApiParameter[];
	body?: JsonSchema;
};

export function buildRouteRequestSchemas(route: MappedRoute): RouteRequestSchemas {
	const queryParams: OpenApiParameter[] = [];
	const pathParams: OpenApiParameter[] = [];
	let bodySchema: JsonSchema | undefined;

	for (const routeArg of route.routeArgs ?? []) {
		if (
			routeArg.argumentLocation != null &&
			InjectedParts.includes(routeArg.argumentLocation)
		) {
			continue;
		}

		if (isPrimitiveOrDateType(routeArg.argumentType)) {
			const location = routeArg.argumentLocation;
			if (location === "query" || location === "params") {
				const param: OpenApiParameter = {
					name: routeArg.mappingKey ?? "value",
					in: location === "params" ? "path" : "query",
					required: location === "params",
					schema: typeToSchema(routeArg.argumentType.name),
				};
				if (location === "params") {
					pathParams.push(param);
				} else {
					queryParams.push(param);
				}
			}
			continue;
		}

		const parts = objectArgToParts(routeArg);
		queryParams.push(...parts.queryParams);
		pathParams.push(...parts.pathParams);
		if (parts.body != null) {
			bodySchema = mergeObjectSchemas(bodySchema, parts.body);
		}
	}

	return { queryParams, pathParams, body: bodySchema };
}

export function objectArgToParts(routeArg: RouteArg): {
	queryParams: OpenApiParameter[];
	pathParams: OpenApiParameter[];
	body?: JsonSchema;
} {
	const queryParams: OpenApiParameter[] = [];
	const pathParams: OpenApiParameter[] = [];
	const bodyProperties: Record<string, JsonSchema> = {};
	const bodyRequired: string[] = [];

	const argLocation = routeArg.argumentLocation;
	for (const [, meta] of routeArg.fieldMap?.entries() ?? []) {
		const location = meta.fieldLocation ?? argLocation;
		const name = meta.mappingKey || meta.fieldKey;
		const schema = typeToSchema(meta.fieldType?.name);

		if (location === "query") {
			queryParams.push({ name, in: "query", required: false, schema });
		} else if (location === "params") {
			pathParams.push({ name, in: "path", required: true, schema });
		} else if (location === "body" || (location == null && argLocation === "body")) {
			bodyProperties[name] = schema;
			bodyRequired.push(name);
		} else if (location == null && argLocation == null) {
			// Unlocated object fields default to body for OpenAPI (common DTO pattern).
			bodyProperties[name] = schema;
			bodyRequired.push(name);
		}
	}

	// Whole-object body argument with no fields still advertises an object body.
	if (argLocation === "body" && Object.keys(bodyProperties).length === 0) {
		return {
			queryParams,
			pathParams,
			body: { type: "object", additionalProperties: true },
		};
	}

	const body =
		Object.keys(bodyProperties).length > 0
			? {
					type: "object",
					properties: bodyProperties,
					required: bodyRequired,
					additionalProperties: false,
				}
			: undefined;

	return { queryParams, pathParams, body };
}

export function mergeObjectSchemas(a: JsonSchema | undefined, b: JsonSchema): JsonSchema {
	if (a == null) {
		return b;
	}
	return {
		type: "object",
		properties: { ...a.properties, ...b.properties },
		required: [...new Set([...(a.required ?? []), ...(b.required ?? [])])],
		additionalProperties: false,
	};
}

export function typeToSchema(typeName?: string): JsonSchema {
	switch (typeName) {
		case "Number":
			return { type: "number" };
		case "Boolean":
			return { type: "boolean" };
		case "Date":
			return { type: "string", format: "date-time" };
		case "String":
			return { type: "string" };
		default:
			return {};
	}
}

/** JSON Schema object for required path params (HTTP path values are always strings). */
export function pathParamsToSchema(params: OpenApiParameter[]): JsonSchema | undefined {
	if (params.length === 0) {
		return undefined;
	}
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];
	for (const param of params) {
		properties[param.name] = { type: "string", minLength: 1 };
		if (param.required !== false) {
			required.push(param.name);
		}
	}
	return {
		type: "object",
		properties,
		required,
		additionalProperties: true,
	};
}
