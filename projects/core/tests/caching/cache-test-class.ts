import { vi } from "vitest";
import { cache } from "../../src/caching/cache.decorator.js";

// Simple cache implementation for testing
class MockCache {
	public get isMemoize(): boolean {
		return false;
	}
	private data = new Map<string, unknown>();

	public get(key: string): unknown {
		return this.data.get(key);
	}

	public set(key: string, value: unknown): void {
		this.data.set(key, value);
	}

	public has(key: string): boolean {
		return this.data.has(key);
	}

	public del(key: string): void {
		this.data.delete(key);
	}

	public flushAll(): void {
		this.data.clear();
	}
}

export const CACHE = new MockCache();

export class CacheTestClass {
	public callCount = 0;
	public counter = vi.fn();

	@cache({ cache: CACHE })
	public syncMethod(value: number): number {
		this.callCount++;
		this.counter();
		return value * 2;
	}

	@cache({ cache: CACHE })
	public async asyncMethod(value: number): Promise<number> {
		this.callCount++;
		this.counter();
		return value * 3;
	}

	@cache({ cache: CACHE })
	public multiArgMethod(arg1: number, arg2: number): number {
		this.callCount++;
		this.counter();
		return arg1 + arg2;
	}

	@cache({ cache: CACHE })
	public undefinedMethod(): undefined {
		this.callCount++;
		this.counter();
		return undefined;
	}

	@cache({ cache: CACHE })
	public falsyMethod(): number {
		this.callCount++;
		this.counter();
		return 0;
	}

	@cache({ name: "TEST_CACHE" })
	public namedCacheMethod(value: number): number {
		this.callCount++;
		this.counter();
		return value * 5;
	}

	@cache()
	public defaultOptionsMethod(value: string): string {
		this.callCount++;
		this.counter();
		return `test-${value}`;
	}

	public reset(): void {
		this.callCount = 0;
		this.counter.mockReset();
	}
}
