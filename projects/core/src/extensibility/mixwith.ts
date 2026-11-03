type Constructor<T = object> = abstract new (...args: unknown[]) => T;

type UnionToIntersection<T> = (T extends unknown ? (arg: T) => void : never) extends (
	arg: infer TResult,
) => void
	? TResult
	: never;

type MixedInstance<TMixins extends readonly Constructor[]> = UnionToIntersection<
	InstanceType<TMixins[number]>
>;

type MixedClass<TMixins extends readonly Constructor[]> = abstract new (
	...args: unknown[]
) => MixedInstance<TMixins>;

const BLOCKED_PROTOTYPE_KEYS = new Set(["constructor", "prototype", "name", "length"]);

function copyPrototypeProperties(target: object, source: object) {
	for (const key of Reflect.ownKeys(source)) {
		if (typeof key === "string" && BLOCKED_PROTOTYPE_KEYS.has(key)) {
			continue;
		}

		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (descriptor == null) {
			continue;
		}

		Object.defineProperty(target, key, descriptor);
	}
}

export function mixwith<TMixins extends readonly Constructor[]>(...mixins: TMixins) {
	abstract class Mixed {}

	for (const mixin of mixins) {
		copyPrototypeProperties(Mixed.prototype, mixin.prototype);
	}

	return Mixed as MixedClass<TMixins>;
}
