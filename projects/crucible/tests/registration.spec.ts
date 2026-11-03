import { ServiceContainerBuilder, RegistrationError, ResolveError } from "@decohere/crucible";
import { injectable } from "@decohere/crucible/decorators";
import { describe, expect, it } from "vitest";

@injectable()
class Alpha {
	public readonly id = "alpha";
}

@injectable()
class Beta {
	public readonly id = "beta";
}

const Token = Symbol("Shared");

describe("duplicate registration", () => {
	it("throws RegistrationError when the same class is registered twice", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Alpha);
		expect(() => builder.registerSingleton(Alpha)).toThrow(RegistrationError);
	});

	it("throws when the same class is re-registered with a different lifetime", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Alpha);
		expect(() => builder.registerTransient(Alpha)).toThrow(RegistrationError);
	});

	it("replaces the previous binding when override is used", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Alpha);
		builder.override.registerTransient(Alpha);
		const container = builder.build();
		const a = container.resolve(Alpha);
		const b = container.resolve(Alpha);
		expect(a).not.toBe(b);
	});

	// Tests swap a real service for a fake one with override. That must work whatever the
	// fake is (another class or a plain object), not only when it is the same class.
	it("override with a different class replaces the binding", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Token, Alpha);
		builder.override.registerSingleton(Token, Beta);
		const container = builder.build();
		expect(container.resolve<Beta>(Token).id).toBe("beta");
	});

	it("override with an instance replaces a class binding", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Alpha);
		const fake = { id: "fake" };
		builder.override.registerSingleton(Alpha, fake);
		const container = builder.build();
		expect(container.resolve(Alpha)).toBe(fake);
	});

	it("override with an instance replaces an earlier instance", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Token, { id: "first" });
		const second = { id: "second" };
		builder.override.registerSingleton(Token, second);
		const container = builder.build();
		expect(container.resolve(Token)).toBe(second);
	});

	it("override replaces every implementation bound to the key", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Token, Alpha);
		builder.registerSingleton(Token, Beta);
		const fake = { id: "fake" };
		builder.override.registerSingleton(Token, fake);
		const container = builder.build();
		expect(container.resolve(Token)).toBe(fake);
	});

	it("registering the same instance twice without override throws", () => {
		const builder = new ServiceContainerBuilder();
		const instance = { id: "one" };
		builder.registerSingleton(Token, instance);
		expect(() => builder.registerSingleton(Token, instance)).toThrow(RegistrationError);
	});

	it("does not mutate the builder when override is accessed", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Alpha);
		void builder.override;
		expect(() => builder.registerSingleton(Alpha)).toThrow(RegistrationError);
	});

	it("does not leave the builder in override mode after an override registration", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Alpha);
		builder.override.registerSingleton(Alpha);
		expect(() => builder.registerSingleton(Alpha)).toThrow(RegistrationError);
	});

	it("keeps both implementations when the same token is bound to two types", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Token, Alpha);
		builder.registerSingleton(Token, Beta);
		const container = builder.build();

		expect(() => container.resolve(Token)).toThrow(ResolveError);
		const all = container.resolveMany(Token);
		expect(all).toHaveLength(2);
		expect(all.some((s) => s instanceof Alpha)).toBe(true);
		expect(all.some((s) => s instanceof Beta)).toBe(true);
	});

	it("throws when the same type is bound twice to the same token", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Token, Alpha);
		expect(() => builder.registerSingleton(Token, Alpha)).toThrow(RegistrationError);
	});

	it("throws for a key that was never registered; resolveMany returns none", () => {
		const container = new ServiceContainerBuilder().build();
		expect(() => container.resolve("missing")).toThrow(
			new ResolveError(
				'Nothing is registered for "missing". Register it, or mark the parameter @optional().',
			),
		);
		expect(container.resolveMany("missing")).toEqual([]);
	});
});
