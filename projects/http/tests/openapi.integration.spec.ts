import axios from "axios";
import { afterEach, describe, expect, it } from "vitest";
import type { App } from "../src/app/app.js";
import { Builder } from "../src/builder/builder.js";
import "../src/http/http.extensions.js";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import {
	Controller,
	Field,
	Get,
	Param,
	Post,
	Put,
	Query,
	RequestParts,
} from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

class CreateBody {
	@Field(RequestParts.body, "message")
	public message!: string;
}

@Controller({ prefix: "/widgets" })
class WidgetController {
	@Get("/:id")
	public getOne(@Param("id") id: string) {
		return { id };
	}

	@Post()
	public create(body: CreateBody) {
		return { message: body.message };
	}
}

/** Mirrors scaffolded HelloController + HelloBody for dogfood validation. */
class HelloBody {
	@Field(RequestParts.body, "message")
	public message!: string;
}

@Controller({ prefix: "/hello" })
class HelloController {
	@Get()
	public getAll(@Query("filter") filter: string) {
		return { filter, message: "hello" };
	}

	@Get("/:id")
	public getOne(@Param("id") id: string) {
		return { id, message: `Hello ${id}!` };
	}

	@Post()
	public create(body: HelloBody) {
		return { message: body.message };
	}

	@Put("/:id")
	public update(@Param("id") id: string, body: HelloBody) {
		return { id, message: body.message };
	}
}

describe("OpenAPI integration", () => {
	let app: App;

	afterEach(async () => {
		await app?.dispose();
	});

	it("serves the OpenAPI document and rejects invalid bodies with typed 400", async () => {
		app = await Builder.create()
			.withOpenApi({
				info: { title: "Widgets API", version: "1.0.0" },
				path: "/openapi.json",
			})
			.withHttpProvider(FastifyProvider)
			.withControllers(WidgetController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const spec = await axios.get("/openapi.json");
		expect(spec.status).toBe(200);
		expect(spec.data.openapi).toBe("3.0.3");
		expect(spec.data.paths["/widgets/{id}"].get).toBeDefined();
		expect(spec.data.paths["/widgets"].post.requestBody).toBeDefined();

		const bad = await axios.post(
			"/widgets",
			{},
			{ headers: { "Content-Type": "application/json" }, validateStatus: () => true },
		);
		expect(bad.status).toBe(400);
		expect(bad.data).toMatchObject({
			statusCode: 400,
			error: "Bad Request",
			message: "Validation failed",
		});
		expect(bad.data.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					keyword: "required",
					message: expect.stringContaining("message"),
				}),
			]),
		);

		const wrongType = await axios.post(
			"/widgets",
			{ message: 42 },
			{ headers: { "Content-Type": "application/json" }, validateStatus: () => true },
		);
		expect(wrongType.status).toBe(400);
		expect(wrongType.data.statusCode).toBe(400);
		expect(wrongType.data.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/body/message",
					keyword: "type",
				}),
			]),
		);

		const extra = await axios.post(
			"/widgets",
			{ message: "hi", surprise: true },
			{ headers: { "Content-Type": "application/json" }, validateStatus: () => true },
		);
		expect(extra.status).toBe(400);
		expect(extra.data.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					keyword: "additionalProperties",
				}),
			]),
		);

		const ok = await axios.post(
			"/widgets",
			{ message: "hi" },
			{ headers: { "Content-Type": "application/json" } },
		);
		expect(ok.status).toBe(200);
		expect(ok.data).toEqual({ message: "hi" });

		const one = await axios.get("/widgets/abc");
		expect(one.status).toBe(200);
		expect(one.data).toEqual({ id: "abc" });
	});

	it("dogfoods Hello routes: fail-closed body validation with typed 400", async () => {
		app = await Builder.create()
			.withOpenApi({
				info: { title: "hello.api", version: "1.0.0" },
			})
			.withHttpProvider(FastifyProvider)
			.withControllers(HelloController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const missing = await axios.post(
			"/hello",
			{},
			{ headers: { "Content-Type": "application/json" }, validateStatus: () => true },
		);
		expect(missing.status).toBe(400);
		expect(missing.data).toMatchObject({
			statusCode: 400,
			error: "Bad Request",
			message: "Validation failed",
		});
		expect(Array.isArray(missing.data.errors)).toBe(true);
		expect(missing.data.errors.length).toBeGreaterThan(0);

		const created = await axios.post(
			"/hello",
			{ message: "hello" },
			{ headers: { "Content-Type": "application/json" } },
		);
		expect(created.status).toBe(200);
		expect(created.data).toEqual({ message: "hello" });

		const updated = await axios.put(
			"/hello/1",
			{ message: "updated" },
			{ headers: { "Content-Type": "application/json" } },
		);
		expect(updated.status).toBe(200);
		expect(updated.data).toEqual({ id: "1", message: "updated" });
	});
});
