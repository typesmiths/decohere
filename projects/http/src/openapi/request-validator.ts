import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import type { HttpRequest, MappedRoute, ValidationIssue } from "../routing/anvil.types.js";
import { ValidationError } from "../routing/anvil.types.js";
import { buildRouteRequestSchemas, pathParamsToSchema } from "./request-schema.js";

export type { ValidationIssue };
export { ValidationError };

/**
 * Fail-closed request validation from route / OpenAPI / `@Field` metadata.
 * Uses AJV against the same schemas as the OpenAPI generator (no type coercion).
 */
export function validateRequest(route: MappedRoute, request: HttpRequest): void {
	const { params, body } = getValidators(route);
	const issues: ValidationIssue[] = [];

	if (params != null) {
		collectIssues(params, request.params ?? {}, "/params", issues);
	}
	if (body != null) {
		collectIssues(body, request.body, "/body", issues);
	}

	if (issues.length > 0) {
		throw new ValidationError("Validation failed", issues);
	}
}

const ajv = new Ajv({
	allErrors: true,
	coerceTypes: false,
	removeAdditional: false,
	useDefaults: false,
	strict: false,
});

type RouteValidators = { params?: ValidateFunction; body?: ValidateFunction };

/**
 * Compiled once per route and reused. Compiling per request was slow, and AJV keeps every
 * schema it compiles, so memory grew with traffic.
 */
const validatorsByRoute = new WeakMap<MappedRoute, RouteValidators>();

function getValidators(route: MappedRoute): RouteValidators {
	let validators = validatorsByRoute.get(route);
	if (validators == null) {
		const schemas = buildRouteRequestSchemas(route);
		const paramsSchema = pathParamsToSchema(schemas.pathParams);
		validators = {
			params: paramsSchema != null ? ajv.compile(paramsSchema) : undefined,
			body: schemas.body != null ? ajv.compile(schemas.body) : undefined,
		};
		validatorsByRoute.set(route, validators);
	}
	return validators;
}

function collectIssues(
	validate: ValidateFunction,
	data: unknown,
	rootPath: string,
	issues: ValidationIssue[],
): void {
	if (validate(data)) {
		return;
	}
	for (const err of validate.errors ?? []) {
		issues.push(toIssue(err, rootPath));
	}
}

function toIssue(err: ErrorObject, rootPath: string): ValidationIssue {
	const instance = err.instancePath ?? "";
	const path = instance.length > 0 ? `${rootPath}${instance}` : rootPath;
	const message = err.message ?? "is invalid";
	return {
		path,
		message: formatAjvMessage(err, message),
		keyword: err.keyword,
	};
}

function formatAjvMessage(err: ErrorObject, fallback: string): string {
	if (err.keyword === "required" && typeof err.params?.missingProperty === "string") {
		return `must have required property '${err.params.missingProperty}'`;
	}
	if (
		err.keyword === "additionalProperties" &&
		typeof err.params?.additionalProperty === "string"
	) {
		return `must NOT have additional property '${err.params.additionalProperty}'`;
	}
	return fallback;
}
