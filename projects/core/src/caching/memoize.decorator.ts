import { CacheDecorator } from "./cache.decorator.js";
import { Caches, Caching } from "./cache-manager.js";

/**
 * Memoize decorator class that extends CacheDecorator with memoization support
 * Automatically uses a memoization-capable cache (a MapCache that hands out references)
 */
export class MemoizeDecorator extends CacheDecorator {
	public decorator(target: object, propertyKey: string, descriptor: PropertyDescriptor) {
		const cache =
			this.options?.cache ?? Caching.getCache(this.options?.name ?? Caches.memoize, true);
		if (!cache.isMemoize) {
			throw new Error(
				"Memoize decorator requires a cache that supports memoization (stores references, not clones)",
			);
		}

		// Pass the resolved cache to the base class by updating options
		// This ensures the base class uses CacheNames.memoize when no cache was provided
		this.options = { ...this.options, cache };

		return super.decorator(target, propertyKey, descriptor);
	}
}

/**
 * Memoize decorator factory
 * Provides true memoization by storing object references instead of clones
 *
 * @param options - Optional configuration for the memoize decorator
 * @returns Decorator function
 */

export const memoize = new MemoizeDecorator().decoratorFactory;
