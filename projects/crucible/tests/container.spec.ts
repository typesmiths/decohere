import {
	type Container,
	ServiceContainerBuilder,
	type LifetimeScope,
	LifetimeScopeToken,
} from "@decohere/crucible";
import { beforeEach, describe, expect, it, vi } from "vitest";

class Disposable {
	public [Symbol.dispose]() {
		this.dispose();
	}
	public dispose() {}
}

class Singleton {
	public nonce: number;
	public constructor() {
		this.nonce = getRandomInt();
	}
}

describe("ServiceContainerBuilder", () => {
	let builder: ServiceContainerBuilder;
	beforeEach(() => {
		vi.clearAllMocks();
		builder = new ServiceContainerBuilder();
	});

	describe("Factories", () => {
		type FactoryResponse = { field: "fieldValue" };
		const FACTORY_KEY = "MY_FACTORY";
		// using a spy for the factory changes the type
		// this is the only way to ensure the factory is actually called
		it("should support arrow functions", () => {
			const builder = new ServiceContainerBuilder();
			const expected: FactoryResponse = { field: "fieldValue" };
			const factory = () => expected;
			builder.registerRequestScoped<FactoryResponse>(FACTORY_KEY, factory);
			const container = builder.build();
			const actual = container.resolve(FACTORY_KEY);
			expect(actual).toEqual(expected);
		});
	});

	describe("Dispose", () => {
		const dispose = vi.spyOn(Disposable.prototype, "dispose");

		it("should dispose the child scope", () => {
			{
				const builder = new ServiceContainerBuilder();
				builder.registerRequestScoped(Disposable);
				const container = builder.build();
				using scope = container.beginScope();
				scope.resolve(Disposable);
			}

			expect(dispose).toHaveBeenCalled();
		});

		it("should dispose root container without recursive self-disposal", () => {
			const builder = new ServiceContainerBuilder();
			const container = builder.build();
			container.resolve(LifetimeScopeToken);

			expect(() => container[Symbol.dispose]()).not.toThrow();
		});

		it("should asyncDispose constructed singletons when the root container is disposed", async () => {
			class Resource {
				public closed = false;
				public async [Symbol.asyncDispose]() {
					this.closed = true;
				}
			}
			const builder = new ServiceContainerBuilder();
			builder.registerSingleton(Resource);
			const container = builder.build();
			const resource = container.resolve(Resource);

			await container[Symbol.asyncDispose]();

			expect(resource.closed).toBe(true);
		});

		// it("should support n level scoped?", () => {
		// 	const builder = new ServiceContainerBuilder();
		// 	builder.registerRequestScoped(Disposable);
		// 	const container = builder.build();
		// 	using scope = container.beginScope();

		// });
	});

	describe("Singletons", () => {
		it("should resolve singleton from the root scope", () => {
			// this checks that the same singleton is resolved in all child scopes
			const builder = new ServiceContainerBuilder();
			builder.registerSingleton(Singleton);
			const container = builder.build();
			const child = container.beginScope();
			const inst1 = container.resolve(Singleton);
			const inst2 = child.resolve(Singleton);
			const manualInst = new Singleton();
			expect(inst1).toBe(inst2);
			expect(manualInst).not.toEqual(inst1);
			expect(manualInst).not.toEqual(inst2);
		});
	});

	describe("registerRequestScoped", () => {
		it("should resolve the same instance in the same scope", () => {
			builder.registerRequestScoped(Disposable);
			const container = builder.build();
			const childA = container.beginScope(getRandomInt().toString());
			const serviceA = childA.resolve(Disposable);
			const serviceB = childA.resolve(Disposable);
			expect(serviceA).toBe(serviceB);
		});

		it("should resolve a new instance per scope", () => {
			builder.registerRequestScoped(Disposable);
			const container = builder.build();
			const childA = container.beginScope(generateScopeId());
			const serviceA = childA.resolve(Disposable);
			const childB = container.beginScope(generateScopeId());
			const serviceB = childB.resolve(Disposable);
			expect(serviceA).not.toBe(serviceB);
		});
	});

	describe("beginScope", () => {
		it("should support n level isolated scopes", () => {
			builder.registerRequestScoped(Disposable);
			const container = builder.build();
			const childA = container.beginScope(generateScopeId());
			const gandchildA = childA.beginScope(generateScopeId());
			const serviceChildA = childA.resolve(Disposable);
			const serviceGandchildA = gandchildA.resolve(Disposable);
			expect(serviceChildA).not.toBe(serviceGandchildA);
		});

		it("should not dispose the child scope if parent is disposed", () => {
			builder.registerRequestScoped(Disposable);
			const container = builder.build();
			let grandChild: Container;
			{
				using child = container.beginScope(generateScopeId());
				grandChild = child.beginScope(generateScopeId());
			}
			expect(() => grandChild.resolve(Disposable)).not.toThrow();
		});

		it("should throw if resolving singleton owned by root if roto scope disposed", () => {
			builder.registerSingleton(Singleton);
			let child: LifetimeScope;
			{
				using container = builder.build();
				child = container.beginScope(generateScopeId());
			}

			expect(() => child.resolve(Singleton)).toThrow();
		});

		it("should dispose if exception is throw", () => {
			builder.registerRequestScoped(Disposable);
			let containerRef: Container;
			try {
				using container = builder.build();
				containerRef = container;
				throw "ERROR";
			} catch {}

			expect(() => containerRef.resolve(Disposable)).toThrow();
		});
	});
});

function generateScopeId() {
	return getRandomInt().toString();
}

function getRandomInt() {
	const min = Math.ceil(0);
	const max = Math.floor(10_000);
	return Math.floor(Math.random() * (max - min + 1)) + min;
}
