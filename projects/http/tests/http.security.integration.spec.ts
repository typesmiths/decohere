import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import axios from "axios";
import { afterEach, describe, expect, it } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "@decohere/http-fastify";
import { Controller, Get, Post } from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

@Controller({ prefix: "/secure" })
class SecureController {
	@Get()
	public get() {
		return { ok: true };
	}

	@Post()
	public post() {
		return { ok: true };
	}
}

describe("HTTP security defaults (helmet, rate-limit, bodyLimit)", () => {
	let app: App;

	afterEach(async () => {
		await app?.dispose();
	});

	it("applies helmet security headers by default", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [SecureController] }))
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const res = await axios.get("/secure");
		expect(res.status).toBe(200);
		expect(res.headers["x-content-type-options"]).toBe("nosniff");
		expect(res.headers["x-dns-prefetch-control"]).toBe("off");
		expect(res.headers["x-frame-options"]).toBeDefined();
	});

	it("disables helmet when helmet: false", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(
				http(FastifyProvider, {
					accessLog: false,
					controllers: [SecureController],
					helmet: false,
				}),
			)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const res = await axios.get("/secure");
		expect(res.status).toBe(200);
		expect(res.headers["x-dns-prefetch-control"]).toBeUndefined();
		expect(res.headers["x-content-type-options"]).toBeUndefined();
	});

	it("rejects oversize bodies with the configured bodyLimit", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(
				http(FastifyProvider, {
					accessLog: false,
					controllers: [SecureController],
					bodyLimit: 64,
					rateLimit: false,
				}),
			)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const res = await axios.post(
			"/secure",
			{ payload: "x".repeat(200) },
			{
				headers: { "Content-Type": "application/json" },
				validateStatus: () => true,
			},
		);
		expect(res.status).toBe(413);
	});

	it("returns 429 when the rate limit is exceeded", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(
				http(FastifyProvider, {
					accessLog: false,
					controllers: [SecureController],
					rateLimit: { max: 1, timeWindow: "1 minute" },
				}),
			)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const first = await axios.get("/secure");
		expect(first.status).toBe(200);

		const second = await axios.get("/secure", { validateStatus: () => true });
		expect(second.status).toBe(429);
	});

	it("skips rate limiting when rateLimit: false", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(
				http(FastifyProvider, {
					accessLog: false,
					controllers: [SecureController],
					rateLimit: false,
				}),
			)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		for (let i = 0; i < 5; i++) {
			const res = await axios.get("/secure");
			expect(res.status).toBe(200);
		}
	});
});
