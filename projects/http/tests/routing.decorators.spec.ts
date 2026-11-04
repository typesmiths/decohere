import { describe, expect, it } from "vitest";
import { RouteConfigurationError } from "../src/routing/http.types.js";
import { Get } from "../src/routing/decorators/index.js";

describe("routing decorators", () => {
	it("throws RouteConfigurationError when a path does not start with /", () => {
		expect(() => {
			class BadController {
				@Get("noslash")
				public bad() {}
			}
			new BadController();
		}).toThrow(RouteConfigurationError);
	});
});
