import { defineMeta, getMeta } from "@decohere/core/reflection";
import { ContainerMeta } from "../const.js";
import type { ServiceKey } from "../models/service-key.js";

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
