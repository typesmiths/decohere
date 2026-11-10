import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RouteMetadata } from "../../http/src/routing/http.types.js";
import { RouteRegistry } from "../../http/src/routing/services/route-registry.js";
import { templates } from "../src/templates/templates.js";
import { HelloController } from "../templates/recipes/webapi/projects/app-name/src/controllers/hello.controller.js";

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

/**
 * Contract: the recipe's Hello routes register without a trailing slash.
 * Regression: `@Post("/")` registered POST /hello/ while clients called POST /hello.
 */
describe("the web API recipe's Hello routes", () => {
	it("enables openApi, so Hello's @Field bodies are validated", () => {
		const app = realFs.readFileSync(
			join(templates.recipesDir(), "webapi/projects/app-name/src/app.ts"),
			"utf8",
		);
		expect(app).toContain("openApi:");
	});

	it("registers the paths clients call", () => {
		const registry = new RouteRegistry();
		registry.addController(HelloController);

		const registered: Record<string, RouteMetadata | undefined> = {
			getAll: registry.getRoute("GET|/hello"),
			getOne: registry.getRoute("GET|/hello/:id"),
			create: registry.getRoute("POST|/hello"),
			update: registry.getRoute("PUT|/hello/:id"),
			remove: registry.getRoute("DELETE|/hello/:id"),
		};

		expect(registered.getAll).toMatchObject({ method: "GET", path: "/hello" });
		expect(registered.getOne).toMatchObject({ method: "GET", path: "/hello/:id" });
		expect(registered.create).toMatchObject({ method: "POST", path: "/hello" });
		expect(registered.update).toMatchObject({ method: "PUT", path: "/hello/:id" });
		expect(registered.remove).toMatchObject({ method: "DELETE", path: "/hello/:id" });
	});
});
