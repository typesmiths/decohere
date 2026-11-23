import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import axios from "axios";
import { afterEach, describe, expect, it } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "@decohere/http-fastify";
import { Controller, Field, Get, Post, Query, RequestParts } from "../src/routing/index.js";
import { startTestApp } from "../src/testing/index.js";

const ISO = "2024-01-15T00:00:00.000Z";

class EventBody {
	@Field(RequestParts.body, "when")
	public when!: Date;
}

@Controller({ prefix: "/events" })
class EventController {
	@Get()
	public get(@Query("when") when: Date) {
		return { when: when instanceof Date ? when.toISOString() : when };
	}

	@Post()
	public create(body: EventBody) {
		return {
			when: body.when instanceof Date ? body.when.toISOString() : body.when,
		};
	}
}

describe("DatePipe over HTTP", () => {
	let app: App;

	afterEach(async () => {
		await app?.dispose();
	});

	async function start() {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [EventController] }))
			.build();
		axios.defaults.baseURL = (await startTestApp(app)).baseUrl;
	}

	it("binds an ISO date query to a Date", async () => {
		await start();
		const res = await axios.get("/events", { params: { when: ISO } });
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ when: ISO });
	});

	it("rejects an empty date query with 400", async () => {
		await start();
		const res = await axios.get("/events?when=", { validateStatus: () => true });
		expect(res.status).toBe(400);
		expect(res.data).toMatchObject({ type: "about:blank", title: "Bad Request", status: 400 });
	});

	it("binds a JSON body date field to a Date", async () => {
		await start();
		const res = await axios.post(
			"/events",
			{ when: ISO },
			{ headers: { "Content-Type": "application/json" } },
		);
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ when: ISO });
	});
});
