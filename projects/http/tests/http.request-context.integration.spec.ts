import type { IConfigurationService } from "@decohere/core/configuration";
import { ConfigurationServiceToken } from "@decohere/core/configuration";
import { type App, Builder } from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";
import { scribe } from "@decohere/scribe";
import { CaptureAdapter } from "@decohere/scribe/testing";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthConfig } from "../src/auth/auth.config.js";
import { auth } from "../src/auth/auth.plugin.js";
import { http } from "../src/http/http.plugin.js";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import { Authorize, Controller, Get, REQUEST_ID_HEADER } from "../src/routing/index.js";
import { Sse, type SseStream } from "../src/sse/index.js";
import { bootModule } from "../src/testing/index.js";
import { startTestApp } from "../src/testing/index.js";

const log = scribe.logger("OrderService");

@injectable()
class OrderService {
	public async place(): Promise<{ placed: true }> {
		await new Promise((resolve) => setTimeout(resolve, 5));
		log.info("order placed");
		return { placed: true };
	}
}

@Controller({ prefix: "/orders" })
class OrderController {
	public constructor(@inject(OrderService) private readonly orders: OrderService) {}

	@Get()
	public place() {
		return this.orders.place();
	}
}

@Controller({ prefix: "/my-orders" })
class MyOrdersController {
	public constructor(@inject(OrderService) private readonly orders: OrderService) {}

	@Authorize("read", "Order")
	@Get()
	public place() {
		return this.orders.place();
	}
}

@Controller({ prefix: "/ticks" })
class TickController {
	@Sse({ heartbeatMs: 0 })
	@Get()
	public async *stream(): SseStream {
		for (const n of [1, 2]) {
			await new Promise((resolve) => setTimeout(resolve, 1));
			log.info("tick sent");
			yield String(n);
		}
	}
}

class DevStaticConfigService implements IConfigurationService {
	public get dataSources() {
		return [];
	}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		if (Object.is(type, AuthConfig)) {
			const config = new AuthConfig();
			config.devStatic = { sub: "user-7", scopes: ["read:Order"] };
			return config as unknown as T;
		}
		return {} as T;
	}
}

describe("request context in log lines", () => {
	let app: App;
	let capture: CaptureAdapter;

	beforeEach(() => {
		capture = new CaptureAdapter();
		scribe.configure({ adapter: capture, options: { logLevel: "info" } });
	});

	afterEach(async () => {
		await app?.dispose();
		vi.unstubAllEnvs();
	});

	async function start(): Promise<void> {
		app = await Builder.create(new ServiceContainerBuilder())
			.withServices((services) => services.registerRequestScoped(OrderService))
			.use(http(FastifyProvider, { controllers: [OrderController] }))
			.build();
		axios.defaults.baseURL = (await startTestApp(app)).baseUrl;
	}

	it("a service's log line carries the request id the response sends back", async () => {
		await start();

		const response = await axios.get("/orders");

		const requestId = response.headers[REQUEST_ID_HEADER];
		expect(requestId).toEqual(expect.any(String));
		const line = capture.entries.find((entry) => entry.msg === "order placed");
		expect(line?.fields).toMatchObject({ requestId });
	});

	it("keeps two concurrent requests apart", async () => {
		await start();

		await Promise.all([
			axios.get("/orders", { headers: { [REQUEST_ID_HEADER]: "first" } }),
			axios.get("/orders", { headers: { [REQUEST_ID_HEADER]: "second" } }),
		]);

		const ids = capture.entries
			.filter((entry) => entry.msg === "order placed")
			.map((entry) => entry.fields.requestId)
			.sort();
		expect(ids).toEqual(["first", "second"]);
	});

	it("adds the signed-in principal once auth has checked the request", async () => {
		vi.stubEnv("NODE_ENV", "development");
		app = await Builder.create(new ServiceContainerBuilder())
			.withServices((services) => {
				services.registerRequestScoped(OrderService);
				services.registerSingleton(ConfigurationServiceToken, new DevStaticConfigService());
			})
			.use(http(FastifyProvider, { controllers: [MyOrdersController] }))
			.use(auth())
			.build();
		axios.defaults.baseURL = (await startTestApp(app)).baseUrl;

		await axios.get("/my-orders", { headers: { Authorization: "Bearer any-token" } });

		const line = capture.entries.find((entry) => entry.msg === "order placed");
		expect(line?.fields).toMatchObject({ principalId: "user-7" });
	});

	it("a server-sent event stream logs with its request's id", async () => {
		await using api = await bootModule({ controllers: [TickController] });

		await api.readEvents("/ticks", { count: 2, headers: { [REQUEST_ID_HEADER]: "stream-1" } });

		const ids = capture.entries
			.filter((entry) => entry.msg === "tick sent")
			.map((entry) => entry.fields.requestId);
		expect(ids).toEqual(["stream-1", "stream-1"]);
	});

	it("a log line outside a request has no request id", async () => {
		await start();
		await axios.get("/orders");

		log.info("between requests");

		const line = capture.entries.find((entry) => entry.msg === "between requests");
		expect(line?.fields).not.toHaveProperty("requestId");
	});
});
