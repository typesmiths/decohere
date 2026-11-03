import "reflect-metadata";
import {
	ServiceContainerBuilder,
	type LifetimeScope,
	LifetimeScopeToken,
	ResolveError,
} from "@decohere/crucible";
import { inject, injectable, optional } from "@decohere/crucible/decorators";
import { describe, expect, it } from "vitest";

/** Two classes named `TokenService`, as two bounded contexts might each have. */
function sameNamedClasses() {
	const billing = (() => {
		@injectable()
		class TokenService {
			public readonly context = "billing";
		}
		return TokenService;
	})();
	const auth = (() => {
		@injectable()
		class TokenService {
			public readonly context = "auth";
		}
		return TokenService;
	})();
	return { billing, auth };
}

describe("keys match by identity", () => {
	it("keeps same-named classes from different contexts apart", () => {
		const { billing, auth } = sameNamedClasses();
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(billing);
		builder.registerSingleton(auth);
		const container = builder.build();

		expect(container.resolve(billing).context).toBe("billing");
		expect(container.resolve(auth).context).toBe("auth");
	});

	it("does not confuse a symbol with a class whose name is its description", () => {
		@injectable()
		class TokenService {}
		const TokenServiceToken = Symbol("TokenService");
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(TokenService);
		const container = builder.build();

		expect(container.resolve(TokenService)).toBeInstanceOf(TokenService);
		expect(() => container.resolve(TokenServiceToken)).toThrow(ResolveError);
	});

	it("does not depend on class names, so minified names still inject", () => {
		@injectable()
		class Dependency {}
		@injectable()
		class Consumer {
			public constructor(public readonly dependency: Dependency) {}
		}
		Object.defineProperty(Dependency, "name", { value: "a" });
		Object.defineProperty(Consumer, "name", { value: "a" });
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Dependency);
		builder.registerSingleton(Consumer);

		expect(builder.build().resolve(Consumer).dependency).toBeInstanceOf(Dependency);
	});
});

describe("missing dependencies fail fast", () => {
	it("names the chain that needed the missing service", () => {
		const AuthToken = Symbol("Auth");
		@injectable()
		class Router {
			public constructor(@inject(AuthToken) public readonly auth: object) {}
		}
		@injectable()
		class App {
			public constructor(public readonly router: Router) {}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Router);
		builder.registerSingleton(App);

		expect(() => builder.build().resolve(App)).toThrow(
			new ResolveError(
				"Nothing is registered for Symbol(Auth) (required by App → Router → Symbol(Auth)). Register it, or mark the parameter @optional().",
			),
		);
	});

	it("passes undefined for an @optional() parameter, so its default applies", () => {
		const AuthToken = Symbol("Auth");
		@injectable()
		class Router {
			public constructor(
				@inject(AuthToken) @optional() public readonly auth: object = { kind: "none" },
			) {}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Router);

		expect(builder.build().resolve(Router).auth).toEqual({ kind: "none" });
	});

	it("still injects an @optional() parameter that is registered", () => {
		@injectable()
		class Clock {}
		@injectable()
		class Scheduler {
			public constructor(@optional() public readonly clock?: Clock) {}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Clock);
		builder.registerSingleton(Scheduler);

		expect(builder.build().resolve(Scheduler).clock).toBeInstanceOf(Clock);
	});

	it("does not let a subclass's @optional() change its base class", () => {
		const Token = Symbol("Dep");
		@injectable()
		class Base {
			public constructor(@inject(Token) public readonly dep?: object) {}
		}
		@injectable()
		class Derived extends Base {
			public constructor(@inject(Token) @optional() dep?: object) {
				super(dep);
			}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Base);
		builder.registerSingleton(Derived);
		const container = builder.build();

		expect(container.resolve(Derived).dep).toBeUndefined();
		expect(() => container.resolve(Base)).toThrow(ResolveError);
	});
});

describe("cycles", () => {
	it("reports the whole cycle instead of overflowing the stack", () => {
		const AToken = Symbol("A");
		const BToken = Symbol("B");
		@injectable()
		class A {
			public constructor(@inject(BToken) public readonly b: object) {}
		}
		@injectable()
		class B {
			public constructor(@inject(AToken) public readonly a: object) {}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerTransient(AToken, A);
		builder.registerTransient(BToken, B);

		expect(() => builder.build().resolve(AToken)).toThrow(
			/^Circular dependency: Symbol\(A\) → Symbol\(B\) → Symbol\(A\)\./,
		);
	});

	it("allows the same service twice in one graph when it is not a cycle", () => {
		@injectable()
		class Shared {}
		@injectable()
		class Left {
			public constructor(public readonly shared: Shared) {}
		}
		@injectable()
		class Right {
			public constructor(public readonly shared: Shared) {}
		}
		@injectable()
		class Root {
			public constructor(
				public readonly left: Left,
				public readonly right: Right,
			) {}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerTypes(Shared, Left, Right, Root);

		const root = builder.build().resolve(Root);
		expect(root.left.shared).toBeInstanceOf(Shared);
		expect(root.right.shared).toBeInstanceOf(Shared);
	});
});

describe("captive dependencies", () => {
	@injectable()
	class QueryRunner {}

	it("rejects a singleton that depends on a request-scoped service", () => {
		@injectable()
		class Repository {
			public constructor(public readonly runner: QueryRunner) {}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerRequestScoped(QueryRunner);
		builder.registerSingleton(Repository);
		using scope = builder.build().beginScope();

		expect(() => scope.resolve(Repository)).toThrow(
			/^Singleton Repository depends on request-scoped QueryRunner \(Repository → QueryRunner\)/,
		);
	});

	it("rejects it through a transient in between", () => {
		@injectable()
		class Mapper {
			public constructor(public readonly runner: QueryRunner) {}
		}
		@injectable()
		class Repository {
			public constructor(public readonly mapper: Mapper) {}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerRequestScoped(QueryRunner);
		builder.registerTransient(Mapper);
		builder.registerSingleton(Repository);
		using scope = builder.build().beginScope();

		expect(() => scope.resolve(Repository)).toThrow(/Repository → Mapper → QueryRunner/);
	});

	it("lets a singleton take the lifetime scope, which for it is the root", () => {
		@injectable()
		class Factory {
			public constructor(@inject(LifetimeScopeToken) public readonly scope: LifetimeScope) {}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Factory);
		const container = builder.build();
		using scope = container.beginScope();

		expect(scope.resolve(Factory).scope).toBe(container);
	});

	it("lets a request-scoped service depend on a singleton", () => {
		@injectable()
		class Config {}
		@injectable()
		class Handler {
			public constructor(public readonly config: Config) {}
		}
		const builder = new ServiceContainerBuilder();
		builder.registerSingleton(Config);
		builder.registerRequestScoped(Handler);
		const container = builder.build();
		using first = container.beginScope();
		using second = container.beginScope();

		expect(first.resolve(Handler).config).toBe(second.resolve(Handler).config);
	});
});

describe("scopes", () => {
	it("look registrations up in their parent and resolve their own lifetime scope", () => {
		@injectable()
		class Service {}
		const builder = new ServiceContainerBuilder();
		builder.registerRequestScoped(Service);
		const container = builder.build();
		using outer = container.beginScope();
		using inner = outer.beginScope();

		expect(inner.resolve(Service)).toBeInstanceOf(Service);
		expect(inner.resolve(Service)).not.toBe(outer.resolve(Service));
		expect(inner.resolve(LifetimeScopeToken)).toBe(inner);
		expect(outer.resolve(LifetimeScopeToken)).toBe(outer);
	});
});
