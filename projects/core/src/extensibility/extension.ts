import type { Type } from "../reflection/types/reflection.types.js";

export type ExtensionOptions = {
	/**
	 * Also install the method on the constructor. Use for singleton facades
	 * (`scribe.withPinoPretty()`) whose instance lives at `ctor.instance`.
	 */
	static?: boolean;
};

export function extension(ctor: Type, options?: ExtensionOptions) {
	return (_target: object, propertyKey: string, descriptor: PropertyDescriptor) => {
		const originalFunction = descriptor.value as (...args: unknown[]) => unknown;

		ctor.prototype[propertyKey] = function (...args: unknown[]) {
			return originalFunction.apply(this, [this, ...args]);
		};

		if (options?.static) {
			Object.defineProperty(ctor, propertyKey, {
				configurable: true,
				writable: true,
				value(...args: unknown[]) {
					const receiver = singletonOf(ctor) ?? this;
					return originalFunction.apply(receiver, [receiver, ...args]);
				},
			});
		}
	};
}

function singletonOf(ctor: Type): unknown {
	return (ctor as { instance?: unknown }).instance;
}
