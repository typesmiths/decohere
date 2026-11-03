// Source https://github.com/voodoocreation/ts-deepmerge/blob/master/package.json

type TAllKeys<T> = T extends unknown ? keyof T : never;

type TIndexValue<T, K extends PropertyKey, D = never> = T extends unknown
	? K extends keyof T
		? T[K]
		: D
	: never;

type TPartialKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>> extends infer O
	? { [P in keyof O]: O[P] }
	: never;

type TFunction = (...a: unknown[]) => unknown;

type TPrimitives = string | number | boolean | bigint | symbol | Date | TFunction;

type TMerged<T> = [T] extends [Array<unknown>]
	? { [K in keyof T]: TMerged<T[K]> }
	: [T] extends [TPrimitives]
		? T
		: [T] extends [object]
			? TPartialKeys<{ [K in TAllKeys<T>]: TMerged<TIndexValue<T, K>> }, never>
			: T;

// istanbul ignore next
const isObject = (obj: unknown) => {
	if (typeof obj === "object" && obj !== null) {
		if (typeof Object.getPrototypeOf === "function") {
			const prototype = Object.getPrototypeOf(obj);
			return prototype === Object.prototype || prototype === null;
		}

		return Object.prototype.toString.call(obj) === "[object Object]";
	}

	return false;
};

interface IObject {
	[key: string]: unknown;
}

export const merge = <T extends object[]>(...objects: T): TMerged<T[number]> =>
	objects.reduce((result, current) => {
		if (current === undefined) {
			return result;
		}

		if (Array.isArray(current)) {
			throw new TypeError("Arguments provided to ts-deepmerge must be objects, not arrays.");
		}

		Object.keys(current).forEach((key) => {
			if (["__proto__", "constructor", "prototype"].includes(key)) {
				return;
			}

			if (Array.isArray(result[key]) && Array.isArray(current[key])) {
				result[key] = merge.options.mergeArrays
					? merge.options.uniqueArrayItems
						? Array.from(new Set((result[key] as unknown[]).concat(current[key])))
						: [...result[key], ...current[key]]
					: current[key];
			} else if (isObject(result[key]) && isObject(current[key])) {
				result[key] = merge(result[key] as IObject, current[key] as IObject);
			} else if (!isObject(result[key]) && isObject(current[key])) {
				result[key] = merge(current[key], undefined);
			} else {
				result[key] =
					current[key] === undefined
						? merge.options.allowUndefinedOverrides
							? current[key]
							: result[key]
						: current[key];
			}
		});

		return result;
	}, {} as IObject) as TMerged<T[number]>;

interface IOptions {
	/**
	 * When `true`, values explicitly provided as `undefined` will override existing values, though properties that are simply omitted won't affect anything.
	 * When `false`, values explicitly provided as `undefined` won't override existing values.
	 *
	 * Default: `true`
	 */
	allowUndefinedOverrides: boolean;

	/**
	 * When `true` it will merge array properties.
	 * When `false` it will replace array properties with the last instance entirely instead of merging their contents.
	 *
	 * Default: `true`
	 */
	mergeArrays: boolean;

	/**
	 * When `true` it will ensure there are no duplicate array items.
	 * When `false` it will allow duplicates when merging arrays.
	 *
	 * Default: `true`
	 */
	uniqueArrayItems: boolean;
}

const defaultOptions: IOptions = {
	allowUndefinedOverrides: true,
	mergeArrays: true,
	uniqueArrayItems: true,
};

merge.options = defaultOptions;

merge.withOptions = <R = unknown, T extends object[] = object[]>(
	options: Partial<IOptions>,
	...objects: T
): R => {
	merge.options = {
		...defaultOptions,
		...options,
	};

	const result = merge(...objects);

	merge.options = defaultOptions;

	return result as unknown as R;
};
