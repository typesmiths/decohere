import axios from "axios";
import { afterEach, describe, expect, it } from "vitest";
import type { App } from "../src/app/app.js";
import { Builder } from "../src/builder/builder.js";
import "../src/http/http.extensions.js";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
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
		app = await Builder.create()
			.withHttpProvider(FastifyProvider)
			.withControllers(SecureController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const res = await axios.get("/secure");
		expect(res.status).toBe(200);
		expect(res.headers["x-content-type-options"]).toBe("nosniff");
		expect(res.headers["x-dns-prefetch-control"]).toBe("off");
		expect(res.headers["x-frame-options"]).toBeDefined();
	});

	it("disables helmet when withHelmet(false)", async () => {
		app = await Builder.create()
			.withHelmet(false)
			.withHttpProvider(FastifyProvider)
			.withControllers(SecureController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const res = await axios.get("/secure");
		expect(res.status).toBe(200);
		expect(res.headers["x-dns-prefetch-control"]).toBeUndefined();
		expect(res.headers["x-content-type-options"]).toBeUndefined();
	});

	it("rejects oversize bodies with the configured bodyLimit", async () => {
		app = await Builder.create()
			.withBodyLimit(64)
			.withRateLimit(false)
			.withHttpProvider(FastifyProvider)
			.withControllers(SecureController)
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
		app = await Builder.create()
			.withRateLimit({ max: 1, timeWindow: "1 minute" })
			.withHttpProvider(FastifyProvider)
			.withControllers(SecureController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const first = await axios.get("/secure");
		expect(first.status).toBe(200);

		const second = await axios.get("/secure", { validateStatus: () => true });
		expect(second.status).toBe(429);
	});

	it("skips rate limiting when withRateLimit(false)", async () => {
		app = await Builder.create()
			.withRateLimit(false)
			.withHttpProvider(FastifyProvider)
			.withControllers(SecureController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		for (let i = 0; i < 5; i++) {
			const res = await axios.get("/secure");
			expect(res.status).toBe(200);
		}
	});
});
