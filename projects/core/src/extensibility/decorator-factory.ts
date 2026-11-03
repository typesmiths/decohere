/**
 * Decorator factory class that provides decorator methods which can be conditionally
 * disabled during unit testing using the @ignoreInUnitTest decorator.
 *
 * Inspired by: https://jasonharper.blog/2018/03/13/decorate-the-decorator-to-exclude-in-unit-testing/
 */

/**
 * Decorator that disables the decorated decorator method when TEST environment variable is true.
 * If TEST=true, it returns a no-op decorator that simply returns the original function unchanged.
 */
export function ignoreInUnitTest(
	_target: object,
	_propertyKey: string,
	descriptor: PropertyDescriptor,
) {
	const originalMethod = descriptor.value as (...args: unknown[]) => unknown;

	descriptor.value = function (this: unknown, ...args: unknown[]) {
		// Check if we're in a test environment
		if (process.env.TEST === "true") {
			// Return a no-op decorator that just returns the original function
			return (originalFunction: unknown) => originalFunction;
		}
		// Otherwise, apply the original decorator method
		return originalMethod.apply(this, args);
	};

	return descriptor;
}

/**
 * Type definition for a function decorator
 */
export type FunctionDecorator = (
	target: object,
	propertyKey: string,
	descriptor: PropertyDescriptor,
) => PropertyDescriptor | undefined;

/**
 * Type definition for a decorator factory function (returns a decorator)
 */
export type DecoratorFactory<TOptions = unknown> = (options?: TOptions) => FunctionDecorator;
