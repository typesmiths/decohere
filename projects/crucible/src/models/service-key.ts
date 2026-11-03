import type { Constructable, FunctionType } from "@decohere/core/reflection";

/**
 * What a service is registered and resolved under, compared by identity: the class (or factory)
 * itself, a symbol, or a string. A string never matches a class with that name, and two symbols
 * with the same description are different keys.
 */
export type ServiceKey = string | symbol | Constructable | FunctionType;

/** A readable name for a key, for error messages. */
export function describeKey(key: ServiceKey): string {
	switch (typeof key) {
		case "string":
			return `"${key}"`;
		case "symbol":
			return key.toString();
		default:
			return key.name || "(anonymous factory)";
	}
}
