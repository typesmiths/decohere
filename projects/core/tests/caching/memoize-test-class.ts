import { vi } from "vitest";
import { memoize } from "../../src/caching/index.js";

// Simple memoization cache implementation for testing
class MockMemoizeCache {
	public get isMemoize(): boolean {
		return true;
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

export const MEMOIZE_CACHE = new MockMemoizeCache();

export class MemoizeTestClass {
	public callCount = 0;
	public counter = vi.fn();

	public reset(): void {
		this.callCount = 0;
		this.counter.mockClear();
		MEMOIZE_CACHE.flushAll();
	}

	@memoize({ cache: MEMOIZE_CACHE })
	public syncMethod(value: number): number {
		this.callCount++;
		this.counter();
		return value * 2;
	}

	@memoize({ cache: MEMOIZE_CACHE })
	public async asyncMethod(value: number): Promise<number> {
		this.callCount++;
		this.counter();
		return value * 3;
	}

	@memoize({ cache: MEMOIZE_CACHE })
	public multiArgMethod(arg1: number, arg2: number): number {
		this.callCount++;
		this.counter();
		return arg1 + arg2;
	}

	@memoize({ cache: MEMOIZE_CACHE })
	public undefinedMethod(): undefined {
		this.callCount++;
		this.counter();
		return undefined;
	}

	@memoize({ cache: MEMOIZE_CACHE })
	public falsyMethod(): number {
		this.callCount++;
		this.counter();
		return 0;
	}

	@memoize({ cache: MEMOIZE_CACHE, name: "custom-cache" })
	public namedCacheMethod(value: number): number {
		this.callCount++;
		this.counter();
		return value * 4;
	}

	@memoize()
	public defaultCacheMethod(value: number): number {
		this.callCount++;
		this.counter();
		return value * 5;
	}

	@memoize()
	public objectMethod(id: number): { id: number; value: number } {
		this.callCount++;
		this.counter();
		return { id, value: id * 10 };
	}
}
