import type { Constructable, FunctionType } from "@decohere/core/reflection";
import { defineArgumentMeta, defineMeta, getMeta } from "@decohere/core/reflection";
import { MetadataKeys } from "../../const.js";
import type { ArgumentMeta } from "../anvil.types.js";

export type AuthorizeOptions = {
	action: string;
	subject: string;
};

/**
 * Require the principal to be able to perform `action` on `subject`.
 * Uses an IAuthorizationService (e.g. CaslAuthorizationService) registered in DI.
 * When applied to a class, all methods inherit the constraint.
 * When applied to a method, it takes precedence over the class-level decorator.
 *
 * @example
 * \@Authorize("delete", "Article")
 * \@Authorize("manage", "all")
 */
export function Authorize(action: string, subject = "all") {
	const options: AuthorizeOptions = { action, subject };
	return (
		target: object | Constructable,
		methodName?: string,
		_descriptor?: PropertyDescriptor,
	) => {
		if (methodName) {
			const fn = (target as object)[methodName];
			defineMeta(MetadataKeys.authorize, options, fn);
		} else {
			defineMeta(MetadataKeys.authorize, options, (target as Constructable).prototype);
		}
	};
}

/**
 * Opt a specific route method out of authentication, even when the controller
 * class is decorated with @Authorize.
 */
export function AllowAnonymous() {
	return (target: object, methodName: string, _descriptor?: PropertyDescriptor) => {
		const fn = (target as object)[methodName];
		defineMeta(MetadataKeys.allowAnonymous, true, fn);
	};
}

/** Read the effective @Authorize options for a handler function. */
export function getAuthorizeOptions(
	controllerPrototype: object,
	handlerFn: object,
): AuthorizeOptions | undefined {
	// Method-level overrides class-level
	const methodLevel = getMeta<AuthorizeOptions>(MetadataKeys.authorize, handlerFn);
	if (methodLevel !== undefined) return methodLevel;
	return getMeta<AuthorizeOptions>(MetadataKeys.authorize, controllerPrototype);
}

/** Returns true only when the handler is explicitly marked @AllowAnonymous. */
export function isAllowAnonymous(_controllerPrototype: object, handlerFn: object): boolean {
	return getMeta<boolean>(MetadataKeys.allowAnonymous, handlerFn) === true;
}

/**
 * Parameter decorator — injects the authenticated Principal into this argument.
 * The argument resolver will supply the principal verified during the auth step.
 */
export function CurrentUser() {
	return (target: object, propertyKey: string, parameterIndex: number) => {
		const fn = (target as Record<string, FunctionType>)[propertyKey];
		const meta: ArgumentMeta = {
			argumentIndex: parameterIndex,
			argumentLocation: "principal",
			mappingKey: undefined,
			pipes: [],
		};
		defineArgumentMeta<ArgumentMeta>(MetadataKeys.parameter, meta, fn, parameterIndex);
	};
}
