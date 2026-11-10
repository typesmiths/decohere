import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import axios, { type AxiosResponse } from "axios";
import { afterEach, describe, expect, it } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import {
	Controller,
	Get,
	HttpError,
	Post,
	Query,
	UnauthorizedError,
} from "../src/routing/index.js";
import { startTestApp } from "../src/testing/index.js";

class OutOfStockError extends HttpError {
	public constructor(sku: string) {
		super(`${sku} is out of stock`, 409, {
			type: "https://shop.example/problems/out-of-stock",
			title: "Out of stock",
			extensions: { sku },
		});
	}
}

@Controller({ prefix: "/orders" })
class OrderController {
	@Get("/gone")
	public gone() {
		throw new HttpError("order 7 was cancelled", 410);
	}

	@Get("/stock")
	public stock() {
		throw new OutOfStockError("SKU-1");
	}

	@Get("/page")
	public page(@Query("size") size: number) {
		return { size };
	}

	@Get("/boom")
	public boom() {
		throw new Error("connection string postgres://secret@db");
	}

	@Get("/private")
	public secret() {
		throw new UnauthorizedError("issuer https://idp.internal did not match");
	}

	@Post()
	public create() {
		return { ok: true };
	}
}

// Every error the API sends is RFC 9457 problem details, so a client handles one shape:
// framework errors, domain errors, unknown routes and bodies Fastify rejects before a handler.
describe("problem details error responses", () => {
	let app: App;

	afterEach(async () => {
		await app?.dispose();
	});

	async function start() {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [OrderController] }))
			.build();
		axios.defaults.baseURL = (await startTestApp(app)).baseUrl;
	}

	async function get(path: string) {
		return axios.get(path, { validateStatus: () => true });
	}

	function expectProblem(res: AxiosResponse) {
		expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
	}

	it("sends an HttpError as a problem with its message as the detail", async () => {
		await start();
		const res = await get("/orders/gone");
		expect(res.status).toBe(410);
		expectProblem(res);
		expect(res.data).toEqual({
			type: "about:blank",
			title: "Gone",
			status: 410,
			detail: "order 7 was cancelled",
		});
	});

	it("sends a domain error's type, title and extension members", async () => {
		await start();
		const res = await get("/orders/stock");
		expect(res.status).toBe(409);
		expectProblem(res);
		expect(res.data).toEqual({
			type: "https://shop.example/problems/out-of-stock",
			title: "Out of stock",
			status: 409,
			detail: "SKU-1 is out of stock",
			sku: "SKU-1",
		});
	});

	it("lists validation issues under errors", async () => {
		await start();
		const res = await get("/orders/page?size=abc");
		expect(res.status).toBe(400);
		expectProblem(res);
		expect(res.data).toMatchObject({ type: "about:blank", title: "Bad Request", status: 400 });
		expect(res.data.errors).toEqual(expect.any(Array));
	});

	it("hides the cause of a 500 and of a 401", async () => {
		await start();
		const boom = await get("/orders/boom");
		expect(boom.status).toBe(500);
		expectProblem(boom);
		expect(boom.data).toEqual({
			type: "about:blank",
			title: "Internal Server Error",
			status: 500,
		});

		const denied = await get("/orders/private");
		expect(denied.status).toBe(401);
		expectProblem(denied);
		expect(denied.data).toEqual({ type: "about:blank", title: "Unauthorized", status: 401 });
	});

	it("answers an unknown route with a 404 problem", async () => {
		await start();
		const res = await get("/nope");
		expect(res.status).toBe(404);
		expectProblem(res);
		expect(res.data).toEqual({
			type: "about:blank",
			title: "Not Found",
			status: 404,
			detail: "Route GET:/nope not found",
		});
	});

	it("answers a body Fastify can't parse with a 400 problem", async () => {
		await start();
		// fetch, not axios: axios would JSON-encode the string into a valid body.
		const res = await fetch(`${axios.defaults.baseURL}/orders`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json",
		});
		expect(res.status).toBe(400);
		expect(res.headers.get("content-type")).toMatch(/^application\/problem\+json/);
		expect(await res.json()).toMatchObject({
			type: "about:blank",
			title: "Bad Request",
			status: 400,
		});
	});
});
