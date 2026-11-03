import { isPromise } from "node:util/types";
import { FunctionDecorator, ignoreIf } from "../system/decorator.js";
import type { CacheOptions } from "./cache.decorator.js";
import { Caches, Caching } from "./cache-manager.js";

type InvalidateCacheOptions = CacheOptions & {
	getKey: (instance: object, args: unknown[]) => string;
};

export class InvalidateCacheDecorator extends FunctionDecorator<InvalidateCacheOptions> {
	@ignoreIf("FORGE_DISABLE_CACHE")
	public decorator(_target: object, _propertyKey: string, descriptor: PropertyDescriptor) {
		const { getKey, cache, name } = this.options;
		const cacheInstance = cache ?? Caching.getCache(name);
		const originalMethod = descriptor.value;

		descriptor.value = function (...args: unknown[]) {
			const resultOrPromise = originalMethod.apply(this, args);
			const evict = () => {
				const key = getKey(this, args);
				cacheInstance.del(key);
			};
			if (isPromise(resultOrPromise)) {
				resultOrPromise.then(evict);
			} else {
				evict();
			}
			return resultOrPromise;
		};
	}
}

const buildGetKey = (
	method: string | ((...args: never[]) => unknown),
	keyFn?: (...args: unknown[]) => string,
) => {
	if (typeof method === "string") return () => method;
	if (keyFn) return (_instance: object, args: unknown[]) => keyFn(...args);
	return (instance: object, args: unknown[]) =>
		Caching.generateCacheKey(instance, method.name, args);
};

export const invalidateCache = (
	method: string | ((...args: never[]) => unknown),
	options?: CacheOptions,
) => {
	const cache = options?.cache ?? Caching.getCache(options?.name);
	return new InvalidateCacheDecorator().decoratorFactory({
		getKey: buildGetKey(method, options?.keyFn),
		...options,
		cache,
	});
};
invalidateCache.evict = (
	instance: object,
	method: (...args: never[]) => unknown,
	args: unknown[] = [],
) => {
	const key = Caching.generateCacheKey(instance, method.name, args);
	Caching.getCache().del(key);
};

export const invalidateMemoize = (
	method: string | ((...args: never[]) => unknown),
	options?: CacheOptions,
) => {
	const cache = options?.cache ?? Caching.getCache(options?.name ?? Caches.memoize, true);
	return new InvalidateCacheDecorator().decoratorFactory({
		getKey: buildGetKey(method),
		...options,
		cache,
	});
};
invalidateMemoize.evict = (
	instance: object,
	method: (...args: never[]) => unknown,
	args: unknown[] = [],
) => {
	const key = Caching.generateCacheKey(instance, method.name, args);
	Caching.getCache(Caches.memoize, true).del(key);
};
