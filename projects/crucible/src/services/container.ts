import {
	type Constructable,
	type FunctionType,
	getMeta,
	isArrayType,
	isConstructable,
	ReflectionMeta,
} from "@decohere/core/reflection";
import { ContainerMeta, LifetimeScopeToken, Scopes } from "../const.js";
import type { InjectionMetadata } from "../decorators/inject.decorator.js";
import { describeKey, type ServiceKey } from "../models/service-key.js";
import type { ServiceRegistration } from "../models/service-registration.model.js";
import { DuplicateScopeError, ResolveError } from "../types/errors.js";
import type { IContainer, LifetimeScope, ResolveRequest } from "../types/types.js";
import { ServiceRegistry } from "./service-registry.js";

type CrucibleOptions = {
	key?: string;
	parent?: Container;
	serviceRegistry: ServiceRegistry;
};

/** The registrations being constructed, outermost first: what asked for the current dependency. */
type ResolutionPath = readonly ServiceRegistration[];

function describePath(path: ResolutionPath, last?: ServiceKey): string {
	const keys = path.map((registration) => registration.key);
	return [...keys, ...(last == null ? [] : [last])].map(describeKey).join(" → ");
}

export class Container implements IContainer {
	public key: string;
	protected instances = new Map<unknown, object>();
	private serviceRegistry: ServiceRegistry;
	private parent?: Container;
	private rootScope: Container;
	private scopes = new Map<string, LifetimeScope>();
	private isDisposed = false;
	public constructor(options?: CrucibleOptions) {
		this.key = options?.key;
		this.serviceRegistry = new ServiceRegistry(options?.serviceRegistry);
		this.registerLifetimeScope();
		this.parent = options?.parent;
		this.rootScope = options?.parent?.rootScope ?? this;
	}

	public resolveMany<T extends object = object>(resolveRequest: ResolveRequest<T>): T[] {
		return this.resolveAll<T>(resolveRequest, []);
	}

	/** Throws {@link ResolveError} when nothing is registered for the key. */
	public resolve<T extends object | object[]>(resolveRequest: ResolveRequest<T>): T {
		return this.resolveOne<T>(resolveRequest, [], false);
	}

	private resolveAll<T extends object>(key: ServiceKey, path: ResolutionPath): T[] {
		const registrations = this.serviceRegistry.getRegistration(key) ?? [];
		return registrations.map((registration) =>
			this.resolveRegistration<T>(registration, path),
		);
	}

	private resolveOne<T extends object | object[]>(
		key: ServiceKey,
		path: ResolutionPath,
		optional: boolean,
	): T {
		const registrations = this.serviceRegistry.getRegistration(key);
		if (registrations == null || registrations.length === 0) {
			if (optional) return undefined;
			const requiredBy = path.length === 0 ? "" : ` (required by ${describePath(path, key)})`;
			throw new ResolveError(
				`Nothing is registered for ${describeKey(key)}${requiredBy}. Register it, or mark the parameter @optional().`,
			);
		}

		if (registrations.length > 1) {
			throw new ResolveError(
				`There are multiple services registered with key ${describeKey(key)}. Use resolveMany to resolve all implementations.`,
			);
		}

		return this.resolveRegistration<T>(registrations[0], path);
	}

	public beginScope(name?: string) {
		if (this.isDisposed) {
			throw new Error("This container has been disposed");
		}
		if (name != null && this.scopes.has(name)) {
			throw new DuplicateScopeError(
				`Cannot create duplicate scope. Scope with ${name} is already created and has not been disposed.`,
			);
		}

		const scope = new Container({
			key: name,
			serviceRegistry: this.serviceRegistry,
			parent: this,
		});

		if (name != null) {
			this.scopes.set(name, scope);
		}
		return scope;
	}

	public [Symbol.dispose]() {
		if (this.isDisposed) {
			return;
		}
		this.disposeSync();
	}

	public async [Symbol.asyncDispose]() {
		if (this.isDisposed) {
			return;
		}
		await this.disposeAsync();
	}

	private disposeSync() {
		if (this.isDisposed) {
			return;
		}

		this.isDisposed = true;
		this.parent?.releaseScope(this.key);
		this.scopes.clear();
		// Reverse creation order: dependents are cleaned up before what they depend on.
		for (const inst of [...this.instances.values()].reverse()) {
			if (inst === this) {
				continue;
			}
			inst[Symbol.dispose]?.();
		}
	}

	private async disposeAsync() {
		if (this.isDisposed) {
			return;
		}

		this.isDisposed = true;
		this.parent?.releaseScope(this.key);
		this.scopes.clear();
		// Reverse creation order: dependents are cleaned up before what they depend on.
		for (const inst of [...this.instances.values()].reverse()) {
			if (inst === this) {
				continue;
			}
			if (Symbol.asyncDispose in inst) {
				await (inst as AsyncDisposable)[Symbol.asyncDispose]();
			} else {
				(inst as Partial<Disposable>)[Symbol.dispose]?.();
			}
		}
	}

	private resolveRegistration<T extends object>(
		registration: ServiceRegistration,
		path: ResolutionPath,
	): T {
		this.assertNoCycle(registration, path);
		this.assertNotCaptive(registration, path);
		const { scope } = registration;
		switch (scope) {
			case Scopes.transient:
				return this.createInstance(registration, path);
			case Scopes.singleton:
				return this.rootScope.getOrCreateInstance(registration, path);
			case Scopes.request:
				return this.getOrCreateInstance(registration, path);
		}
	}

	private assertNoCycle(registration: ServiceRegistration, path: ResolutionPath) {
		if (!path.includes(registration)) return;
		throw new ResolveError(
			`Circular dependency: ${describePath(path, registration.key)}. Break the cycle, e.g. by resolving one side lazily from the LifetimeScope.`,
		);
	}

	/**
	 * A singleton lives for the whole process, so a request-scoped service it depends on (directly
	 * or through transients) would be created once and then shared by every request, e.g. one
	 * QueryRunner for the life of the process. The container's own lifetime scope is exempt: a
	 * singleton asking for it gets the root, which is the scope it lives in.
	 */
	private assertNotCaptive(registration: ServiceRegistration, path: ResolutionPath) {
		if (registration.scope !== Scopes.request || registration.key === LifetimeScopeToken)
			return;
		const singleton = path.find((owner) => owner.scope === Scopes.singleton);
		if (singleton == null) return;
		throw new ResolveError(
			`Singleton ${describeKey(singleton.key)} depends on request-scoped ${describeKey(registration.key)} (${describePath(path, registration.key)}). A singleton would keep the first request's instance forever: make ${describeKey(singleton.key)} request-scoped, or resolve ${describeKey(registration.key)} per request from the LifetimeScope.`,
		);
	}

	private getOrCreateInstance<T extends object>(
		registration: ServiceRegistration,
		path: ResolutionPath,
	): T {
		if (this.isDisposed) {
			throw new Error("This container has been disposed");
		}
		const { type, isInstance } = registration;
		// One cache entry per registration: an instance registration is its own entry.
		const cacheKey = type;
		const existingInstance = this.instances.get(cacheKey);
		if (existingInstance != null) {
			return existingInstance as T;
		}

		const instance = isInstance ? (type as T) : this.createInstance<T>(registration, path);
		this.instances.set(cacheKey, instance);
		return instance;
	}

	private createInstance<T extends object>(
		registration: ServiceRegistration,
		path: ResolutionPath,
	): T {
		const type = registration.type as Constructable | FunctionType;
		const canConstruct = isConstructable(type);
		const deps = this.resolveDependencies(type, [...path, registration]);
		const inst = (canConstruct ? new type(...deps) : type()) as T;
		return inst;
	}

	private resolveDependencies(
		type: Constructable | FunctionType,
		path: ResolutionPath,
	): unknown[] {
		const params = getMeta<Array<Constructable>>(ReflectionMeta.paramtypes, type) ?? [];
		const injectTokens =
			getMeta<InjectionMetadata>(ContainerMeta.injecttoken, type) ?? new Map();

		return params.map((param, index) => {
			const token = injectTokens.get(index);
			const key = token?.key ?? param;
			if (key == null || key === Object || (token?.key == null && isArrayType(param))) {
				if (token?.optional) return undefined;
				throw new ResolveError(
					`Cannot tell what to inject for constructor parameter ${index} of ${describePath(path)}: its type is not a class at run time (an interface, an array, or a type-only import). Add @inject(token) to the parameter.`,
				);
			}
			return isArrayType(param)
				? this.resolveAll(key, path)
				: this.resolveOne(key, path, token?.optional === true);
		});
	}

	private releaseScope(name: string | undefined) {
		if (name == null) {
			return;
		}
		this.scopes.delete(name);
	}

	private registerLifetimeScope() {
		this.serviceRegistry.replaceType(Scopes.request, {
			typeOrKey: LifetimeScopeToken,
			typeOrInstance: this,
		});
	}
}
