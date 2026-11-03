import { vi } from "vitest";
import type { Constructable } from "@decohere/core/reflection";

/**
 * Creates a Proxy around a class constructor that intercepts `new` calls,
 * records arguments via a spy, and delegates to the real constructor.
 *
 * Use this to assert what was injected into a class by a DI container
 * (e.g. Container) without changing actual behavior.
 *
 * The proxy copies all `reflect-metadata` entries from the original class
 * so that DI metadata (`design:paramtypes`) remains intact.
 *
 * @example
 * const { spy, Proxy: SpiedService } = spyOnConstructor(MyService);
 * // use SpiedService in place of MyService when wiring the container
 * expect(spy).toHaveBeenCalledWith(expect.any(ExpectedDependency));
 */
export function spyOnConstructor<T extends Constructable>(
	Target: T,
): { spy: ReturnType<typeof vi.fn>; Proxy: T } {
	const spy = vi.fn();
	const ProxiedTarget = new Proxy(Target, {
		construct(Ctor, args) {
			spy(...args);
			return Reflect.construct(Ctor, args);
		},
	});
	for (const key of Reflect.getMetadataKeys(Target)) {
		Reflect.defineMetadata(key, Reflect.getMetadata(key, Target), ProxiedTarget);
	}
	return { spy, Proxy: ProxiedTarget as T };
}
