import type { Constructable, FunctionType } from "@decohere/core/reflection";
import { describeKey, type ServiceKey } from "../models/service-key.js";
import { ServiceRegistration } from "../models/service-registration.model.js";
import { RegistrationError } from "../types/errors.js";
import type { Scope } from "../types/types.js";

export type RegisterTypeOptions = {
	typeOrKey: ServiceKey;
	typeOrInstance?: Constructable | FunctionType | object;
	override?: boolean;
};

/**
 * Registrations by key. A scope's registry holds only what the scope adds (its own lifetime
 * scope) and looks everything else up in its parent, so beginning a scope costs the same however
 * many services are registered.
 */
export class ServiceRegistry {
	readonly #registrations = new Map<ServiceKey, ServiceRegistration[]>();
	readonly #parent?: ServiceRegistry;

	public constructor(parent?: ServiceRegistry) {
		this.#parent = parent;
	}

	public registerType(scope: Scope, options: RegisterTypeOptions) {
		const registration = this.createRegistrationFrom(scope, options);
		// Override means "this key now resolves to this", e.g. a test fake: replace every binding.
		if (options.override) {
			this.#registrations.set(registration.key, [registration]);
			return registration;
		}

		const existing = this.getRegistration(registration.key) ?? [];
		const duplicate = existing.find((reg) => reg.isEqual(registration));
		if (duplicate != null) {
			throw new RegistrationError(
				`A service is already registered for key ${describeKey(registration.key)}. Use builder.override.registerSingleton() (or the matching register* method) to replace it.`,
			);
		}

		this.#registrations.set(registration.key, [...existing, registration]);
		return registration;
	}

	public replaceType(scope: Scope, options: RegisterTypeOptions) {
		const registration = this.createRegistrationFrom(scope, options);
		this.#registrations.set(registration.key, [registration]);
		return registration;
	}

	public getRegistration(key: ServiceKey): ServiceRegistration[] | undefined {
		return this.#registrations.get(key) ?? this.#parent?.getRegistration(key);
	}

	private createRegistrationFrom(scope: Scope, options: RegisterTypeOptions) {
		const { typeOrKey, typeOrInstance } = options;
		const isKey = typeof typeOrKey === "string" || typeof typeOrKey === "symbol";
		const isInstance = typeof typeOrInstance === "object";
		const type = isInstance ? typeOrInstance : isKey ? typeOrInstance : typeOrKey;
		return new ServiceRegistration(typeOrKey, type, scope, isInstance);
	}
}
