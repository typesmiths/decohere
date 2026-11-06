import {
	type Constructable,
	defineMeta,
	type FunctionType,
	getMeta,
} from "../reflection/index.js";

/** Resolves to the scope that is resolving: inject it to resolve services later. */
export const LifetimeScopeToken = Symbol("LifetimeScope");

export const ContainerMeta = {
	injecttoken: "Container:injecttoken",
} satisfies Record<string, string>;

/**
 * What a service is registered and resolved under, compared by identity: the class (or factory)
 * itself, a symbol, or a string. A string never matches a class with that name, and two symbols
 * with the same description are different keys.
 */
export type ServiceKey = string | symbol | Constructable | FunctionType;

export type InjectionMetadata = Map<number, InjectionToken>;

export type InjectionToken = {
	/** The key to resolve; without one, the parameter's type is the key. */
	key?: ServiceKey;
	/** Pass `undefined` instead of throwing when nothing is registered for the key. */
	optional?: boolean;
};

/**
 * Bind a constructor parameter to a registration key. Keys match by identity: a class matches only
 * itself (not a string of its name), and a symbol only itself. Prefer the class; use a symbol for an
 * interface or several implementations. `@inject(SomeClass)` also keeps SomeClass's import, which
 * a parameter used only as a type can lose (its run-time type then collapses to `Object`).
 */
export function inject(key: ServiceKey) {
	return updateToken((token) => ({ ...token, key }));
}

/**
 * Mark a constructor parameter as optional: when nothing is registered for it, the container
 * passes `undefined` (so a default value applies) instead of throwing.
 */
export function optional() {
	return updateToken((token) => ({ ...token, optional: true }));
}

function updateToken(update: (token: InjectionToken | undefined) => InjectionToken) {
	return (target: object, _propertyKey: string | symbol | undefined, idx: number) => {
		// Copy: the metadata can be inherited from a base class, which must not change.
		const metadata = new Map(getMeta<InjectionMetadata>(ContainerMeta.injecttoken, target));
		metadata.set(idx, update(metadata.get(idx)));
		defineMeta(ContainerMeta.injecttoken, metadata, target);
	};
}

export type ResolveRequest<T extends object = object> = string | symbol | Constructable<T>;

export type Scope = "single-instance" | "request" | "transient";

export interface ServiceProvider {
	/**
	 * @param key
	 * @throws {ServiceNotFoundException}
	 */
	resolve<T extends object>(key: ResolveRequest<T>): T;

	resolveMany<T extends object = object>(resolveRequest: ResolveRequest<T>): T[];
}

export interface LifetimeScope extends ServiceProvider {
	/** A name must be unique among open scopes; omit it for per-request scopes. */
	beginScope(name?: string): LifetimeScope;
	[Symbol.dispose](): void;
	[Symbol.asyncDispose](): Promise<void>;
}

export interface IContainer extends LifetimeScope {}

export interface ContainerRegistrar {
	registerTransient(key: string | symbol, type: Constructable): unknown;
	registerTransient(type: Constructable): unknown;

	registerRequestScoped<T>(type: () => T): unknown;
	registerRequestScoped<T>(key: string | symbol, type: () => T): unknown;
	registerRequestScoped(key: string | symbol, type: Constructable): unknown;
	registerRequestScoped(type: Constructable): unknown;

	registerSingleton(key: string | symbol | Constructable, instance: object): unknown;
	registerSingleton(key: string | symbol, type: Constructable): unknown;
	registerSingleton(type: Constructable): unknown;

	registerType(type: Constructable, scope?: Scope): unknown;

	registerTypes(...types: Constructable[]): unknown[];
	registerTypes(scope: Scope, ...types: Constructable[]): unknown[];
}

export interface ContainerBuilder extends ContainerRegistrar {
	readonly override: ContainerRegistrar;
	build(): IContainer;
}
