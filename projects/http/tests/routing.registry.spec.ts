import { describe, expect, it } from "vitest";
import { RouteConfigurationError } from "../src/routing/anvil.types.js";
import { Argument, Controller, Field, Get } from "../src/routing/index.js";
import { RouteRegistry } from "../src/routing/services/route-registry.js";

describe("RouteRegistry", () => {
	it("throws when a field has no location and no arg-level location", () => {
		class BadParams {
			@Field()
			public q: string;
		}

		@Controller()
		class BadController {
			@Get("/bad")
			public bad(@Argument({}) _params: BadParams) {}
		}

		const registry = new RouteRegistry();
		expect(() => registry.addController(BadController)).toThrow(RouteConfigurationError);
	});

	// Two handlers for the same method and path used to overwrite each other silently,
	// so one of them was never reachable.
	it("throws when two handlers register the same method and path", () => {
		@Controller({ prefix: "/items" })
		class FirstController {
			@Get()
			public list() {}
		}

		@Controller({ prefix: "/items" })
		class SecondController {
			@Get()
			public listAgain() {}
		}

		const registry = new RouteRegistry();
		registry.addController(FirstController);
		expect(() => registry.addController(SecondController)).toThrow(
			/GET \/items.*FirstController\.list.*SecondController\.listAgain/,
		);
	});
});
