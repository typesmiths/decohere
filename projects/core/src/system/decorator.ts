export abstract class FunctionDecorator<TOptions = undefined> {
	protected options: TOptions;
	public constructor() {
		this.decoratorFactory = this.decoratorFactory.bind(this);
	}

	public abstract decorator(
		target: object,
		propertyKey: string,
		descriptor: PropertyDescriptor,
	);

	public decoratorFactory(options?: TOptions) {
		this.options = options;
		return this.decorator.bind(this);
	}
}

/**
 * Skips the decorated method decorator if any of the named environment variables equal "true".
 * Useful for disabling decorators like @cache() during unit tests or via feature flags.
 *
 * @example @ignoreIf("TEST", "DISABLE_CACHE")
 */
export function ignoreIf(...envVars: string[]) {
	return (_: object, __: string, descriptor: PropertyDescriptor) => {
		const originalFunction = descriptor.value;
		descriptor.value = function (target: object, key: string, descriptor: PropertyDescriptor) {
			if (envVars.some((v) => process.env[v] === "true")) {
				return descriptor;
			}
			return originalFunction.bind(this)(target, key, descriptor);
		};
		return descriptor;
	};
}

/** @deprecated Use ignoreIf("TEST") instead */
export function ignoreDuringUnitTest() {
	return ignoreIf("TEST");
}
