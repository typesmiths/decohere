import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionDecorator, ignoreDuringUnitTest } from "../../src/system/decorator.js";

// Test decorator class
class TestDecorator extends FunctionDecorator {
	@ignoreDuringUnitTest()
	public decorator(
		_target: object,
		_propertyKey: string,
		descriptor: PropertyDescriptor,
	): PropertyDescriptor {
		const originalMethod = descriptor.value;
		descriptor.value = function (...args: unknown[]) {
			// Add "decorated-" prefix to show decorator was applied
			const result = originalMethod.apply(this, args);
			return `decorated-${result}`;
		};
		return descriptor;
	}
}

// Another test decorator without @ignoreInUnitTest
class AlwaysActiveDecorator extends FunctionDecorator {
	public decorator(_target: object, _propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		descriptor.value = function (...args: unknown[]) {
			const result = originalMethod.apply(this, args);
			return `always-${result}`;
		};
		return descriptor;
	}
}

const createTestDecorator = new TestDecorator().decoratorFactory;
const createAlwaysActiveDecorator = new AlwaysActiveDecorator().decoratorFactory;

describe("ignoreInUnitTest decorator", () => {
	let originalTestEnv: string | undefined;

	beforeEach(() => {
		originalTestEnv = process.env.TEST;
	});

	afterEach(() => {
		if (originalTestEnv !== undefined) {
			process.env.TEST = originalTestEnv;
		} else {
			delete process.env.TEST;
		}
	});

	describe("when TEST environment variable is not set", () => {
		beforeEach(() => {
			delete process.env.TEST;
		});

		it("should apply decorator normally", () => {
			class TestClass {
				@createTestDecorator()
				public getValue(): string {
					return "original";
				}
			}

			const instance = new TestClass();
			const result = instance.getValue();

			expect(result).toBe("decorated-original");
		});
	});

	describe("when TEST=false", () => {
		beforeEach(() => {
			process.env.TEST = "false";
		});

		it("should apply decorator normally", () => {
			class TestClass {
				@createTestDecorator()
				public getValue(): string {
					return "original";
				}
			}

			const instance = new TestClass();
			const result = instance.getValue();

			expect(result).toBe("decorated-original");
		});
	});

	describe("when TEST=true", () => {
		beforeEach(() => {
			process.env.TEST = "true";
		});

		it("should disable decorator and return original function", () => {
			class TestClass {
				@createTestDecorator()
				public getValue(): string {
					return "original";
				}
			}

			const instance = new TestClass();
			const result = instance.getValue();

			expect(result).toBe("original"); // No decoration applied
		});

		it("should still apply decorators that are not marked with @ignoreInUnitTest", () => {
			class TestClass {
				@createAlwaysActiveDecorator()
				public getValue(): string {
					return "original";
				}
			}

			const instance = new TestClass();
			const result = instance.getValue();

			expect(result).toBe("always-original"); // Decoration still applied
		});
	});

	describe("multiple decorators", () => {
		it("should disable decorator when marked with @ignoreInUnitTest when TEST=true", () => {
			process.env.TEST = "true";

			class TestClass {
				@createTestDecorator() // This will be disabled and return original function
				public getValue(): string {
					return "original";
				}
			}

			const instance = new TestClass();
			const result = instance.getValue();

			// When a decorator with @ignoreInUnitTest is disabled, it returns the original function
			expect(result).toBe("original");
		});

		it("should work with multiple decorators where some have @ignoreInUnitTest", () => {
			process.env.TEST = "true";

			// Test with the non-ignored decorator applied first
			class TestClass1 {
				@createAlwaysActiveDecorator() // This will be active
				public getValue(): string {
					return "original";
				}
			}

			// Test with the ignored decorator applied first
			class TestClass2 {
				@createTestDecorator() // This will be disabled
				public getValue(): string {
					return "original";
				}
			}

			const instance1 = new TestClass1();
			const instance2 = new TestClass2();

			expect(instance1.getValue()).toBe("always-original");
			expect(instance2.getValue()).toBe("original");
		});

		it("should apply all decorators when TEST is not true", () => {
			delete process.env.TEST;

			class TestClass {
				@createTestDecorator() // This will be active
				@createAlwaysActiveDecorator() // This will be active
				public getValue(): string {
					return "original";
				}
			}

			const instance = new TestClass();
			const result = instance.getValue();

			// Both decorators should be applied (decorators apply bottom-to-top)
			expect(result).toBe("decorated-always-original");
		});
	});

	describe("FunctionDecorator base class", () => {
		it("should bind decoratorFactory method correctly", () => {
			const decorator = new TestDecorator();
			const factory = decorator.decoratorFactory;

			expect(typeof factory).toBe("function");
			expect(factory).toBe(decorator.decoratorFactory);
		});

		it("should return the decorator method from decoratorFactory", () => {
			const decorator = new TestDecorator();
			const factory = decorator.decoratorFactory();

			expect(typeof factory).toBe("function");
		});
	});

	describe("ignoreDuringUnitTest function behavior", () => {
		it("should wrap decorator methods to respect TEST environment variable", () => {
			// Create a mock decorator method
			const originalDecoratorMethod = vi.fn((_target, _key, descriptor) => {
				const originalMethod = descriptor.value;
				descriptor.value = function (...args: unknown[]) {
					return `decorated-${originalMethod.apply(this, args)}`;
				};
				return descriptor;
			});

			const mockDescriptor = {
				value: originalDecoratorMethod,
			};

			// Apply @ignoreDuringUnitTest to the decorator method
			ignoreDuringUnitTest()({}, "testMethod", mockDescriptor);

			// Create a test target and method to decorate
			const testTarget = {};
			const testPropertyKey = "testMethod";
			const testMethodDescriptor = {
				value: () => "original",
			};

			// When TEST is not set, should call original decorator method
			delete process.env.TEST;
			const result1 = mockDescriptor.value(testTarget, testPropertyKey, testMethodDescriptor);
			expect(originalDecoratorMethod).toHaveBeenCalledWith(
				testTarget,
				testPropertyKey,
				testMethodDescriptor,
			);
			expect(result1).toBe(testMethodDescriptor); // Original decorator modifies descriptor in place

			// When TEST=true, should return descriptor unchanged (no-op behavior)
			process.env.TEST = "true";
			originalDecoratorMethod.mockClear();
			const originalDescriptor = { value: () => "untouched" };
			const result2 = mockDescriptor.value(testTarget, testPropertyKey, originalDescriptor);
			expect(originalDecoratorMethod).not.toHaveBeenCalled();
			expect(result2).toBe(originalDescriptor); // Should return descriptor unchanged
		});
	});
});
