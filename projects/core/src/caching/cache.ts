/**
 * Interface for cache implementations used by the @cache() decorator
 */
export interface ICache {
	get(key: string): unknown;
	set(key: string, value: unknown): void;
	has(key: string): boolean;
	del(key: string): void;
	flushAll();
	get isMemoize(): boolean;
}
