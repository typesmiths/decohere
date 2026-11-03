import { isPromise } from "node:util/types";
import { FunctionDecorator, ignoreIf } from "../system/decorator.js";
import type { ICache } from "./cache.js";
import { Caching } from "./cache-manager.js";

/**
 * Options for configuring the @cache() decorator
 */
export interface CacheOptions {
	cache?: ICache;
	name?: string;
	/**
	 * Custom key function. When provided, replaces the default instance-scoped key
	 * with a caller-defined key, enabling cross-instance cache sharing.
	 */
	keyFn?: (...args: unknown[]) => string;
}

export class CacheDecorator extends FunctionDecorator<CacheOptions> {
	@ignoreIf("FORGE_DISABLE_CACHE")
	public decorator(_target: object, propertyKey: string, descriptor: PropertyDescriptor) {
		const cacheInstance = this.options?.cache ?? Caching.getCache(this.options?.name);
		const keyFn = this.options?.keyFn;
		const originalMethod = descriptor.value;

		const wrapped = function (...args: unknown[]) {
			const cacheKey = keyFn
				? keyFn(...args)
				: Caching.generateCacheKey(this, propertyKey, args);
			if (cacheInstance.has(cacheKey)) {
				const val = cacheInstance.get(cacheKey);
				return val;
			}

			const resultOrPromise = originalMethod.apply(this, args);
			if (isPromise(resultOrPromise)) {
				resultOrPromise.then(
					(result) => {
						cacheInstance.set(cacheKey, result);
					},
					() => {
						/* rejection propagates via the returned promise */
					},
				);
			} else {
				cacheInstance.set(cacheKey, resultOrPromise);
			}

			return resultOrPromise;
		};
		Object.defineProperty(wrapped, "name", { value: propertyKey });
		descriptor.value = wrapped;
	}
}

export const cache = new CacheDecorator().decoratorFactory;
