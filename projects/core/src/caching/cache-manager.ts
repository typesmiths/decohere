import type { ICache } from "./cache.js";
import { MapCache } from "./map-cache.js";

export const Caches = {
	default: "DEFAULT",
	memoize: "MEMOIZE_CACHE",
} as const;

/**
 * Central cache manager for managing named cache instances
 */
class CacheManager {
	private caches = new Map<string, ICache>();
	private readonly defaultCacheName = Caches.default;

	/**
	 * Set a cache instance with the given name
	 * @param name - The name of the cache
	 * @param cache - The cache instance
	 */
	public setCache(name: string, cache: ICache): void {
		this.caches.set(name, cache);
	}

	/**
	 * Get a cache instance by name
	 * @param name - The name of the cache, defaults to "DEFAULT"
	 * @returns The cache instance
	 */
	public getCache(name?: string, memoize: boolean = false): ICache {
		const cacheName = name ?? this.defaultCacheName;

		if (!this.caches.has(cacheName)) {
			const cache = new MapCache({ memoize });
			this.caches.set(cacheName, cache);
		}

		return this.caches.get(cacheName);
	}

	/**
	 * Clear a cache by name. If no name is provided, clears the default cache.
	 * Note: This only works if the cache implements a clear() method.
	 * @param name - The name of the cache to clear
	 */
	public flush(name?: string): void {
		const cacheName = name ?? this.defaultCacheName;
		const cache = this.caches.get(cacheName);
		cache.flushAll();
	}

	public flushAllCaches(): void {
		for (const [, cache] of this.caches) {
			cache.flushAll();
		}
	}

	/**
	 * Remove a cache instance by name
	 * @param name - The name of the cache to remove
	 */
	public removeCache(name: string): void {
		this.caches.delete(name);
	}

	/**
	 * Check if a cache with the given name exists
	 * @param name - The name of the cache
	 * @returns True if the cache exists, false otherwise
	 */
	public hasCache(name: string): boolean {
		return this.caches.has(name);
	}

	private readonly instanceIds = new WeakMap<object, number>();
	private instanceIdCounter = 0;

	/**
	 * Generate a cache key for a given instance, function name, and arguments.
	 * Each instance receives a stable numeric ID so cache entries are never
	 * shared across instances of the same class.
	 * @param instance - The class instance (`this` at call time)
	 * @param functionName - The name of the decorated method
	 * @param args - The method arguments
	 * @returns A unique cache key string
	 */
	public generateCacheKey(instance: object, functionName: string, args: unknown[]): string {
		if (!this.instanceIds.has(instance)) {
			this.instanceIds.set(instance, ++this.instanceIdCounter);
		}
		const instanceId = this.instanceIds.get(instance);
		const argsStr = JSON.stringify({ args }, (_key, val) =>
			typeof val === "function" ? `[Function:${val.name}]` : val,
		);
		return `${instance.constructor.name}#${instanceId}|${functionName}|${argsStr}`;
	}
}

/**
 * Singleton instance of the cache manager
 */
export const Caching = new CacheManager();
