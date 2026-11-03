import "reflect-metadata";
import { ServiceContainerBuilder, ResolveError } from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";
import { ReflectionMeta } from "@decohere/core/reflection";
import { describe, expect, it } from "vitest";

@injectable()
class SampleService {
	public getGreeting(): string {
		return "hello";
	}
}

/**
 * SWC can drop an import used only as a type, so design:paramtypes collapses to
 * Object. The container used to pass null and fail later with a TypeError; now it fails at resolve time
 * and says to add @inject. @inject(SampleService) also keeps the import.
 */
describe("DI when design:paramtypes is Object", () => {
	it("throws at resolve time, pointing at @inject, when paramtypes is Object", () => {
		class HelloController {
			public constructor(public readonly sample: SampleService) {}
		}
		Reflect.defineMetadata(ReflectionMeta.paramtypes, [Object], HelloController);

		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(SampleService);
		builder.registerRequestScoped(HelloController);
		const container = builder.build();
		using scope = container.beginScope("req");
		expect(() => scope.resolve(HelloController)).toThrow(
			new ResolveError(
				"Cannot tell what to inject for constructor parameter 0 of HelloController: its type is not a class at run time (an interface, an array, or a type-only import). Add @inject(token) to the parameter.",
			),
		);
	});

	it("does not match a string key to the class of that name", () => {
		class HelloController {
			public constructor(@inject("SampleService") public readonly sample: SampleService) {}
		}
		Reflect.defineMetadata(ReflectionMeta.paramtypes, [Object], HelloController);

		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(SampleService);
		builder.registerRequestScoped(HelloController);
		const container = builder.build();
		using scope = container.beginScope("req");
		expect(() => scope.resolve(HelloController)).toThrow(
			/Nothing is registered for "SampleService"/,
		);
	});

	it("resolves SampleService when @inject is the class despite Object paramtypes", () => {
		class HelloController {
			public constructor(@inject(SampleService) public readonly sample: SampleService) {}
			public greet() {
				return this.sample.getGreeting();
			}
		}
		Reflect.defineMetadata(ReflectionMeta.paramtypes, [Object], HelloController);

		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(SampleService);
		builder.registerRequestScoped(HelloController);
		const container = builder.build();
		using scope = container.beginScope("req");
		const hello = scope.resolve(HelloController);
		expect(hello.sample).toBeInstanceOf(SampleService);
		expect(hello.greet()).toBe("hello");
	});
});
