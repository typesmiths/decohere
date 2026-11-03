import type { FunctionDecorator } from "./decorator-factory.js";

/**
 * Base class for creating decorator factory instances with methods that can be
 * conditionally disabled during unit testing.
 *
 * Example usage:
 * ```typescript
 * class MyDecoratorFactory extends DecoratorFactory {
 *   @ignoreInUnitTest
 *   cache(options?: CacheOptions) {
 *     return cache(options);
 *   }
 *
 *   @ignoreInUnitTest
 *   logger(options?: LoggerOptions) {
 *     return logger(options);
 *   }
 * }
 *
 * const decorators = new MyDecoratorFactory();
 *
 * class TestClass {
 *   @decorators.cache({ ttl: 1000 })
 *   async getData() {
 *     // This decorator will be disabled when TEST=true
 *   }
 * }
 * ```
 */

export abstract class DecoratorFactoryBase {
	/**
	 * Utility method to check if we're currently in a test environment
	 */
	protected isTestEnvironment(): boolean {
		return process.env.TEST === "true";
	}

	/**
	 * Creates a no-op decorator that returns the original function unchanged
	 */
	protected createNoOpDecorator(): FunctionDecorator {
		return (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) =>
			descriptor;
	}
}
