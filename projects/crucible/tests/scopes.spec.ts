import {
	ServiceContainerBuilder,
	DuplicateScopeError,
	type LifetimeScope,
	LifetimeScopeToken,
} from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";
import { describe, expect, it } from "vitest";

@injectable()
class RequestWork {
	public readonly nonce = Math.random();
}

@injectable()
class SharedClock {
	public readonly nonce = Math.random();
}

@injectable()
class ScopeProbe {
	public constructor(@inject(LifetimeScopeToken) public readonly scope: LifetimeScope) {}
}

describe("beginScope", () => {
	it("allows the same name again after the previous scope is disposed", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerRequestScoped(RequestWork);
		const container = builder.build();

		{
			using scope = container.beginScope("req");
			expect(scope.resolve(RequestWork)).toBeInstanceOf(RequestWork);
		}

		using again = container.beginScope("req");
		expect(again.resolve(RequestWork)).toBeInstanceOf(RequestWork);
	});

	it("throws DuplicateScopeError when the same name is still live", () => {
		const container = new ServiceContainerBuilder().build();
		using _live = container.beginScope("req");
		expect(() => container.beginScope("req")).toThrow(DuplicateScopeError);
	});

	it("allows two unnamed scopes to overlap", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerRequestScoped(RequestWork);
		const container = builder.build();
		using a = container.beginScope();
		using b = container.beginScope();
		expect(a.resolve(RequestWork)).not.toBe(b.resolve(RequestWork));
	});

	it("resolves the same singleton from nested scopes as from the root", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(SharedClock);
		const container = builder.build();
		const child = container.beginScope("child");
		const grandchild = child.beginScope("grandchild");

		const fromGrandchild = grandchild.resolve(SharedClock);
		const fromRoot = container.resolve(SharedClock);
		expect(fromGrandchild).toBe(fromRoot);
	});

	it("resolves LifetimeScopeToken to the current child scope", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerRequestScoped(ScopeProbe);
		const container = builder.build();
		using child = container.beginScope("req");

		expect(child.resolve(LifetimeScopeToken)).toBe(child);
		const probe = child.resolve(ScopeProbe);
		expect(probe.scope).toBe(child);
	});

	it("throws when beginning a scope on a disposed container", () => {
		const container = new ServiceContainerBuilder().build();
		container[Symbol.dispose]();
		expect(() => container.beginScope("req")).toThrow(/disposed/i);
	});

	it("does not leak a named scope after dispose so many sequential requests can reuse ids", () => {
		const builder = new ServiceContainerBuilder();
		builder.registerRequestScoped(RequestWork);
		const container = builder.build();

		for (let i = 0; i < 3; i++) {
			using scope = container.beginScope("same-request-id");
			expect(scope.resolve(RequestWork)).toBeInstanceOf(RequestWork);
		}
	});
});

// A scope must clean up objects in reverse creation order (dependents before their
// dependencies), and wait for async cleanup to finish.
describe("scope disposal order", () => {
	it("async-disposes instances in reverse creation order", async () => {
		const order: string[] = [];
		class First {
			public async [Symbol.asyncDispose]() {
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push("first");
			}
		}
		class Second {
			public async [Symbol.asyncDispose]() {
				order.push("second");
			}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerRequestScoped(First);
		builder.registerRequestScoped(Second);
		const container = builder.build();

		const scope = container.beginScope();
		scope.resolve(First);
		scope.resolve(Second);
		await scope[Symbol.asyncDispose]();

		expect(order).toEqual(["second", "first"]);
	});
});
