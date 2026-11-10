import { describe, expect, it } from "vitest";
import type { RouteMetadata } from "../../http/src/routing/http.types.js";
import {
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Put,
	Query,
} from "../../http/src/routing/index.js";
import { RouteRegistry } from "../../http/src/routing/services/route-registry.js";
import { ControllerSourceFile } from "../src/webapi/models/controller-source-file.model.js";
import { MainSourceFile } from "../src/webapi/models/main-source-file.model.js";

/**
 * Contract: scaffolded Hello routes register without a trailing slash.
 * Regression: `@Post("/")` registered POST /hello/ while clients called POST /hello.
 */

describe("Hello controller route contract", () => {
	it("generates @Post() without a trailing-slash path", () => {
		const content = new ControllerSourceFile().files()[0]?.content ?? "";
		expect(content).toMatch(/@Post\(\)/);
		expect(content).not.toMatch(/@Post\("\/"\)/);
	});

	it("enables openApi by default so Hello @Field bodies are validated", () => {
		const content = new MainSourceFile("demo.api").files()[0]?.content ?? "";
		expect(content).toContain("openApi:");
		expect(content).toContain('title: "demo.api"');
	});

	it("registers the paths clients call", () => {
		@Controller({ prefix: "/hello" })
		class HelloController {
			@Get()
			public getAll(@Query("filter") _filter: string) {}

			@Get("/:id")
			public getOne(@Param("id") _id: string) {}

			@Post()
			public create() {}

			@Put("/:id")
			public update(@Param("id") _id: string) {}

			@Delete("/:id")
			public remove(@Param("id") _id: string) {}
		}

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
