import { ServiceContainerBuilder } from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";
import { describe, expect, it } from "vitest";

type Provider = { id: string };

const Providers = Symbol("Providers");

@injectable()
class Router {
	public constructor(@inject(Providers) public readonly providers: Provider[]) {}
}

@injectable()
class ClassA implements Provider {
	public readonly id = "a";
}

@injectable()
class ClassB implements Provider {
	public readonly id = "b";
}

// Every instance registered under one token must resolve to itself, in registration order.
describe("several instances under one token", () => {
	for (const count of [2, 3]) {
		const instances = Array.from({ length: count }, (_, i) => ({ id: `p${i}` }));

		it(`resolveMany returns each of ${count} instances in registration order`, () => {
			const builder = new ServiceContainerBuilder();
			for (const instance of instances) {
				builder.registerSingleton(Providers, instance);
			}
			const resolved = builder.build().resolveMany<Provider>(Providers);
			expect(resolved).toHaveLength(count);
			resolved.forEach((p, i) => {
				expect(p).toBe(instances[i]);
			});
		});

		it(`an array-typed constructor parameter receives ${count} distinct instances`, () => {
			const builder = new ServiceContainerBuilder();
			for (const instance of instances) {
				builder.registerSingleton(Providers, instance);
			}
			builder.registerSingleton(Router);
			const router = builder.build().resolve(Router);
			expect(router.providers).toHaveLength(count);
			router.providers.forEach((p, i) => {
				expect(p).toBe(instances[i]);
			});
		});
	}

	it("returns the same instances on repeated resolves", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Providers, { id: "x" });
		builder.registerSingleton(Providers, { id: "y" });
		const container = builder.build();
		const first = container.resolveMany(Providers);
		const second = container.resolveMany(Providers);
		expect(second[0]).toBe(first[0]);
		expect(second[1]).toBe(first[1]);
	});

	it("override still replaces every instance with the new one", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Providers, { id: "x" });
		builder.registerSingleton(Providers, { id: "y" });
		const fake = { id: "fake" };
		builder.override.registerSingleton(Providers, fake);
		expect(builder.build().resolveMany(Providers)).toEqual([fake]);
	});

	it("still caches one singleton per class when classes share a token", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Providers, ClassA);
		builder.registerSingleton(Providers, ClassB);
		const container = builder.build();
		const first = container.resolveMany<Provider>(Providers);
		const second = container.resolveMany<Provider>(Providers);
		expect(first.map((p) => p.id).sort()).toEqual(["a", "b"]);
		expect(second[0]).toBe(first[0]);
		expect(second[1]).toBe(first[1]);
	});
});
