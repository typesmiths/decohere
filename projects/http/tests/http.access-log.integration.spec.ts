import { scribe } from "@decohere/scribe";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app/app.js";
import { Builder } from "../src/builder/builder.js";
import "../src/http/http.extensions.js";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import {
	Controller,
	Get,
	HttpAccessLogMiddleware,
	REQUEST_ID_HEADER,
} from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

@Controller({ prefix: "/ping" })
class PingController {
	@Get()
	public ping() {
		return { ok: true };
	}
}

describe("withHttp request id + access logging", () => {
	let app: App;
	const accessLog = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		trace: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn(),
		isLevelEnabled: () => true,
		currentLevel: "info",
		logLevels: {},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		const originalLogger = scribe.logger.bind(scribe);
		vi.spyOn(scribe, "logger").mockImplementation((name: string) => {
			if (name === HttpAccessLogMiddleware.name) {
				return accessLog as never;
			}
			return originalLogger(name);
		});
	});

	afterEach(async () => {
		await app?.dispose();
		vi.restoreAllMocks();
	});

	it("echoes inbound x-request-id and logs access via Scribe", async () => {
		app = await Builder.create()
			.withHttp(FastifyProvider)
			.withControllers(PingController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const inboundId = "req-test-869eja7vz";
		const response = await axios.get("/ping", {
			headers: { [REQUEST_ID_HEADER]: inboundId },
		});

		expect(response.status).toBe(200);
		expect(response.headers[REQUEST_ID_HEADER]).toBe(inboundId);
		expect(accessLog.info).toHaveBeenCalledWith(
			expect.objectContaining({
				msg: "access",
				method: "GET",
				path: "/ping",
				status: 200,
				requestId: inboundId,
				durationMs: expect.any(Number),
			}),
		);
	});

	it("generates a request id when the client omits the header", async () => {
		app = await Builder.create()
			.withHttp(FastifyProvider)
			.withControllers(PingController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const response = await axios.get("/ping");
		const requestId = response.headers[REQUEST_ID_HEADER];
		expect(typeof requestId).toBe("string");
		expect(requestId.length).toBeGreaterThan(0);
		expect(accessLog.info).toHaveBeenCalledWith(
			expect.objectContaining({
				msg: "access",
				requestId,
				status: 200,
			}),
		);
	});

	it("does not write access logs when withHttp({ accessLog: false })", async () => {
		app = await Builder.create()
			.withHttp(FastifyProvider, { accessLog: false })
			.withControllers(PingController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const response = await axios.get("/ping");
		expect(response.status).toBe(200);
		expect(accessLog.info).not.toHaveBeenCalled();
	});
});
