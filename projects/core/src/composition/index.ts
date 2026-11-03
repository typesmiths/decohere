import type { Constructable } from "../reflection/index.js";

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
