import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { scribe } from "@decohere/scribe";
import { CaptureAdapter } from "@decohere/scribe/testing";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "@decohere/http-fastify";
import {
	Controller,
	Get,
	HttpAccessLogMiddleware,
	REQUEST_ID_HEADER,
} from "../src/routing/index.js";
import { startTestApp } from "../src/testing/index.js";

@Controller({ prefix: "/ping" })
class PingController {
	@Get()
	public ping() {
		return { ok: true };
	}
}

describe("http() request id + access logging", () => {
	let app: App;
	let capture: CaptureAdapter;
	const accessLines = () =>
		capture.entries.filter((entry) => entry.name === HttpAccessLogMiddleware.name);

	beforeEach(() => {
		capture = new CaptureAdapter();
		scribe.configure({ adapter: capture, options: { logLevel: "info" } });
	});

	afterEach(async () => {
		await app?.dispose();
	});

	it("echoes inbound x-request-id and logs access via Scribe", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { controllers: [PingController] }))
			.build();
		axios.defaults.baseURL = (await startTestApp(app)).baseUrl;

		const inboundId = "req-test-869eja7vz";
		const response = await axios.get("/ping", {
			headers: { [REQUEST_ID_HEADER]: inboundId },
		});

		expect(response.status).toBe(200);
		expect(response.headers[REQUEST_ID_HEADER]).toBe(inboundId);
		expect(accessLines()).toEqual([
			expect.objectContaining({
				level: "info",
				msg: "access",
				fields: expect.objectContaining({
					method: "GET",
					path: "/ping",
					status: 200,
					requestId: inboundId,
					durationMs: expect.any(Number),
				}),
			}),
		]);
	});

	it("generates a request id when the client omits the header", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { controllers: [PingController] }))
			.build();
		axios.defaults.baseURL = (await startTestApp(app)).baseUrl;

		const response = await axios.get("/ping");
		const requestId = response.headers[REQUEST_ID_HEADER];
		expect(typeof requestId).toBe("string");
		expect(requestId.length).toBeGreaterThan(0);
		expect(accessLines()).toEqual([
			expect.objectContaining({
				msg: "access",
				fields: expect.objectContaining({ requestId, status: 200 }),
			}),
		]);
	});

	it("does not write access logs when http(provider, { accessLog: false })", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [PingController] }))
			.build();
		axios.defaults.baseURL = (await startTestApp(app)).baseUrl;

		const response = await axios.get("/ping");
		expect(response.status).toBe(200);
		expect(accessLines()).toEqual([]);
	});
});
