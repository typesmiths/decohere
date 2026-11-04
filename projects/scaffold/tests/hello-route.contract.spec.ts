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
import { POSTMAN_CALLBACKS } from "../src/webapi/features/postman.feature.js";
import { ControllerSourceFile } from "../src/webapi/models/controller-source-file.model.js";
import { MainSourceFile } from "../src/webapi/models/main-source-file.model.js";
import { buildHelloOpenApiDocument } from "../src/webapi/postman/hello-openapi.js";

/**
 * Contract: scaffolded Hello routes must match Postman / OpenAPI paths.
 * Regression: `@Post("/")` registered POST /hello/ while Postman called POST /hello.
 */

describe("Hello controller ↔ Postman route contract", () => {
	it("generates @Post() without a trailing-slash path", () => {
		const content = new ControllerSourceFile().files()[0]?.content ?? "";
		expect(content).toMatch(/@Post\(\)/);
		expect(content).not.toMatch(/@Post\("\/"\)/);
	});

	it("enables withOpenApi by default so Hello @Field bodies are validated", () => {
		const content = new MainSourceFile("demo.api").files()[0]?.content ?? "";
		expect(content).toContain("withOpenApi");
		expect(content).toContain('title: "demo.api"');
	});

	it("registers the same paths OpenAPI / Postman Local View call", () => {
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

		const openapi = buildHelloOpenApiDocument("Contract");
		expect(Object.keys(openapi.paths)).toEqual(
			expect.arrayContaining(["/hello", "/hello/{id}"]),
		);

		const postman = {
			list: { method: "GET", url: "{{baseUrl}}/hello" },
			getOne: { method: "GET", url: "{{baseUrl}}/hello/:id" },
			create: { method: "POST", url: "{{baseUrl}}/hello" },
			update: { method: "PUT", url: "{{baseUrl}}/hello/:id" },
			remove: { method: "DELETE", url: "{{baseUrl}}/hello/:id" },
		};
		expect(postman.create.url.replace("{{baseUrl}}", "")).toBe(registered.create?.path);
		expect(postman.list.url.replace("{{baseUrl}}", "")).toBe(registered.getAll?.path);
		expect(postman.getOne.url.replace("{{baseUrl}}", "")).toBe(registered.getOne?.path);
		expect(postman.update.url.replace("{{baseUrl}}", "")).toBe(registered.update?.path);
		expect(postman.remove.url.replace("{{baseUrl}}", "")).toBe(registered.remove?.path);
	});

	it("keeps Postman OAuth callbacks stable (sanity for auth contract)", () => {
		expect(POSTMAN_CALLBACKS).toContain("https://oauth.pstmn.io/v1/callback");
	});
});
