import type { ServiceKey } from "@decohere/core/composition";

export type { ServiceKey };

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
