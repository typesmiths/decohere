import type { Constructable, FunctionType } from "@decohere/core/reflection";
import type { Scope } from "../types/types.js";
import type { ServiceKey } from "./service-key.js";

export class ServiceRegistration {
	public key: ServiceKey;
	public scope: Scope;
	public type: Constructable | FunctionType | object;
	public isInstance: boolean;

	public constructor(
		key: ServiceKey,
		type: Constructable | FunctionType | object,
		scope: Scope,
		isInstance: boolean,
	) {
		this.key = key;
		this.type = type;
		this.scope = scope;
		this.isInstance = isInstance;
	}

	/** Same class, or the same instance object. */
	public isEqual(other: ServiceRegistration) {
		return this.type === other.type;
	}
}
