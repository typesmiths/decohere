import type { Constructable, FunctionType } from "@decohere/core/reflection";
import { Scopes } from "../const.js";
import type { ServiceRegistration } from "../models/service-registration.model.js";
import type { ContainerBuilder, ContainerRegistrar, Scope } from "../types/types.js";
import { Container } from "./container.js";
import type { RegisterTypeOptions } from "./service-registry.js";
import { ServiceRegistry } from "./service-registry.js";

type ContainerBuilderOptions = {
	serviceRegistry: ServiceRegistry;
};

type RegisterFn = (
	typeOrKey: RegisterTypeOptions["typeOrKey"],
	typeOrInstance?: RegisterTypeOptions["typeOrInstance"],
) => ServiceRegistration;

export class ServiceContainerBuilder implements ContainerBuilder {
	private serviceRegistry: ServiceRegistry;
	public constructor(options?: ContainerBuilderOptions) {
		this.serviceRegistry = options?.serviceRegistry ?? new ServiceRegistry();
	}

	public get override(): ContainerRegistrar {
		return this.createRegistrar(true);
	}

	public registerType(type: Constructable, scope: Scope = Scopes.transient) {
		return this.register(false)(scope)(type, type);
	}

	public registerTypes(...types: Constructable[]): ServiceRegistration[];
	public registerTypes(scope: Scope, ...types: Constructable[]): ServiceRegistration[];
	public registerTypes(
		scopeOrType: Scope | Constructable,
		...types: Constructable[]
	): ServiceRegistration[] {
		return this.registerMany(false, scopeOrType, types);
	}

	public registerTransient(
		key: string | symbol,
		type: Constructable | FunctionType,
	): ServiceRegistration;
	public registerTransient(type: Constructable): ServiceRegistration;
	public registerTransient(typeOrKey: string | symbol | Constructable, type?: Constructable) {
		return this.register(false)(Scopes.transient)(typeOrKey, type);
	}

	public registerSingleton(
		key: string | symbol | Constructable | object,
		instance: object,
	): ServiceRegistration;
	public registerSingleton(key: string | symbol, type: Constructable): ServiceRegistration;
	public registerSingleton(type: Constructable): ServiceRegistration;
	public registerSingleton(
		typeOrKey: string | symbol | Constructable,
		typeOrInstance?: Constructable | object,
	) {
		return this.register(false)(Scopes.singleton)(typeOrKey, typeOrInstance);
	}

	public registerRequestScoped<T>(type: () => T): ServiceRegistration;
	public registerRequestScoped<T>(key: string | symbol, type: () => T): ServiceRegistration;
	public registerRequestScoped(key: string | symbol, type: Constructable): ServiceRegistration;
	public registerRequestScoped(type: Constructable): ServiceRegistration;
	public registerRequestScoped(
		typeOrKey: string | symbol | Constructable | FunctionType,
		type?: Constructable | FunctionType,
	) {
		return this.register(false)(Scopes.request)(typeOrKey, type);
	}

	public build(): Container {
		return new Container({ serviceRegistry: this.serviceRegistry });
	}

	private register =
		(override: boolean) =>
		(scope: Scope): RegisterFn =>
		(typeOrKey, typeOrInstance) =>
			this.serviceRegistry.registerType(scope, {
				typeOrKey,
				typeOrInstance,
				override,
			});

	private registerMany(
		override: boolean,
		scopeOrType: Scope | Constructable,
		types: Constructable[],
	): ServiceRegistration[] {
		const bind = this.register(override);
		const isScope = typeof scopeOrType !== "function";
		const scope = isScope ? scopeOrType : Scopes.transient;
		const allTypes = isScope ? types : [scopeOrType, ...types];
		return allTypes.map((type) => bind(scope)(type, type));
	}

	private createRegistrar(override: boolean): ContainerRegistrar {
		const bind = this.register(override);
		return {
			registerType: (type, scope = Scopes.transient) => bind(scope)(type, type),
			registerTypes: ((scopeOrType, ...types) =>
				this.registerMany(
					override,
					scopeOrType,
					types,
				)) as ContainerRegistrar["registerTypes"],
			registerTransient: ((typeOrKey, type?) =>
				bind(Scopes.transient)(typeOrKey, type)) as ContainerRegistrar["registerTransient"],
			registerSingleton: ((typeOrKey, typeOrInstance?) =>
				bind(Scopes.singleton)(
					typeOrKey,
					typeOrInstance,
				)) as ContainerRegistrar["registerSingleton"],
			registerRequestScoped: ((typeOrKey, type?) =>
				bind(Scopes.request)(typeOrKey, type)) as ContainerRegistrar["registerRequestScoped"],
		};
	}
}
